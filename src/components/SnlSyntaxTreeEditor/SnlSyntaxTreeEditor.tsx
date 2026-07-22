import { useMemo, useState } from 'react'
import type { SnlMacroRecord } from '../../snl-macro/types'
import type { SnlSyntaxTree } from '../../snl-syntax-tree/types'

interface SnlSyntaxTreeEditorProps {
  value: SnlSyntaxTree
  onChange: (next: SnlSyntaxTree) => void
  templateDb?: SnlMacroRecord
  nodeIndex?: number
}

function updateChildAt(
  children: SnlSyntaxTree[],
  index: number,
  updater: (child: SnlSyntaxTree) => SnlSyntaxTree,
): SnlSyntaxTree[] {
  return children.map((child, i) => (i === index ? updater(child) : child))
}

/** Interactive tree editor for the demo app. Not part of the core render library. */
export function SnlSyntaxTreeEditor({
  value,
  onChange,
  templateDb,
  nodeIndex = 1,
}: SnlSyntaxTreeEditorProps) {
  const updateNode = (patch: Partial<SnlSyntaxTree>) => {
    onChange({ ...value, ...patch })
  }

  const [nameSuggestIndex, setNameSuggestIndex] = useState(0)
  const [showNameSuggest, setShowNameSuggest] = useState(false)
  const [activeInput, setActiveInput] = useState<'name' | null>(null)

  const nameSuggestions = useMemo(() => {
    const prefix = value.macro_name.trim().toLowerCase()
    if (!templateDb) {
      return []
    }
    const allNames = Object.keys(templateDb)
    if (!prefix) {
      return allNames.slice(0, 6)
    }
    return allNames
      .filter((name) => name.toLowerCase().startsWith(prefix))
      .slice(0, 6)
  }, [templateDb, value.macro_name])

  // v1 扁平 schema：宏名唯一即命中（不再有 style 层）
  const nameMatched = Boolean(templateDb?.[value.macro_name])

  const applyNameSuggestion = (index?: number) => {
    const selected = nameSuggestions[index ?? nameSuggestIndex] ?? nameSuggestions[0]
    if (!selected) {
      return
    }
    updateNode({ macro_name: selected })
    setShowNameSuggest(false)
    setNameSuggestIndex(0)
  }

  return (
    <div className="tree-editor">
      <div className="tree-editor-row">
        <div className="tree-editor-left-tag">#{nodeIndex}</div>
        <div className="tree-input-with-suggest tree-name-wrap">
          <input
            className={[
              'tree-name-input',
              nameMatched ? 'match-ok' : '',
              activeInput === 'name' && !nameMatched ? 'match-fail' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            value={value.macro_name}
            onFocus={() => {
              setActiveInput('name')
              setShowNameSuggest(true)
            }}
            onBlur={() => {
              setActiveInput((prev) => (prev === 'name' ? null : prev))
              setTimeout(() => setShowNameSuggest(false), 120)
            }}
            onChange={(e) => {
              setNameSuggestIndex(0)
              setShowNameSuggest(true)
              updateNode({ macro_name: e.target.value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowNameSuggest(false)
                return
              }
              if (!showNameSuggest || nameSuggestions.length === 0) {
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setNameSuggestIndex((prev) => (prev + 1) % nameSuggestions.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setNameSuggestIndex((prev) => (prev - 1 + nameSuggestions.length) % nameSuggestions.length)
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                applyNameSuggestion()
              }
            }}
            placeholder="name"
          />
          {showNameSuggest && nameSuggestions.length > 0 && (
            <ul className="tree-suggest-list">
              {nameSuggestions.map((candidate, index) => (
                <li
                  key={candidate}
                  className={index === nameSuggestIndex ? 'active' : ''}
                  onMouseDown={() => applyNameSuggestion(index)}
                >
                  {candidate}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="tree-children">
        {value.children.map((child, index) => (
          <div key={`child-${index}`} className="tree-child-item">
            <SnlSyntaxTreeEditor
              value={child}
              templateDb={templateDb}
              nodeIndex={index + 1}
              onChange={(nextChild) => {
                updateNode({
                  children: updateChildAt(value.children, index, () => nextChild),
                })
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
