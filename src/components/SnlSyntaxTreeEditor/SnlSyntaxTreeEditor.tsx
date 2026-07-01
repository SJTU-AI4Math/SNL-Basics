import { useEffect, useMemo, useState } from 'react'
import { getEffectiveStyle } from '../../snl-syntax-tree/effective-style'
import type { TemplateDb } from '../../snl-syntax-tree/template-db'
import type { OperatorTree } from '../../snl-syntax-tree/types'

interface OperatorTreeEditorProps {
  value: OperatorTree
  onChange: (next: OperatorTree) => void
  templateDb?: TemplateDb
  nodeIndex?: number
}

function updateChildAt(
  children: OperatorTree[],
  index: number,
  updater: (child: OperatorTree) => OperatorTree,
): OperatorTree[] {
  return children.map((child, i) => (i === index ? updater(child) : child))
}

export function OperatorTreeEditor({
  value,
  onChange,
  templateDb,
  nodeIndex = 1,
}: OperatorTreeEditorProps) {
  const updateNode = (patch: Partial<OperatorTree>) => {
    onChange({ ...value, ...patch })
  }

  const [nameSuggestIndex, setNameSuggestIndex] = useState(0)
  const [styleSuggestIndex, setStyleSuggestIndex] = useState(0)
  const [showNameSuggest, setShowNameSuggest] = useState(false)
  const [showStyleSuggest, setShowStyleSuggest] = useState(false)
  const [activeInput, setActiveInput] = useState<'name' | 'style' | null>(null)

  const nameSuggestions = useMemo(() => {
    const prefix = value.name.trim().toLowerCase()
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
  }, [templateDb, value.name])

  const styleSuggestions = useMemo(() => {
    if (!templateDb) {
      return []
    }
    const direct = templateDb[value.name]?.styles
    const byName = direct ?? templateDb[nameSuggestions[0]]?.styles
    if (!byName) {
      return []
    }
    const prefix = value.style.trim().toLowerCase()
    const allStyles = Object.keys(byName)
    if (!prefix) {
      return allStyles.slice(0, 6)
    }
    return allStyles
      .filter((style) => style.toLowerCase().startsWith(prefix))
      .slice(0, 6)
  }, [nameSuggestions, templateDb, value.name, value.style])

  const nameMatched = Boolean(templateDb?.[value.name])
  const styleMatched = Boolean(value.style && templateDb?.[value.name]?.styles?.[value.style])

  const applyNameSuggestion = (index?: number) => {
    const selected = nameSuggestions[index ?? nameSuggestIndex] ?? nameSuggestions[0]
    if (!selected) {
      return
    }
    // 选择 operator 后清空 style，让自动规则补齐默认 style。
    updateNode({ name: selected, style: '' })
    setShowNameSuggest(false)
    setNameSuggestIndex(0)
  }

  const applyStyleSuggestion = (index?: number) => {
    const selected = styleSuggestions[index ?? styleSuggestIndex] ?? styleSuggestions[0]
    if (!selected) {
      return
    }
    updateNode({ style: selected })
    setShowStyleSuggest(false)
    setStyleSuggestIndex(0)
  }

  useEffect(() => {
    const byName = templateDb?.[value.name]
    if (!byName) {
      return
    }

    const autoStyle =
      value.style || getEffectiveStyle(value, templateDb) || Object.keys(byName.styles)[0]
    if (!autoStyle) {
      return
    }

    const template = byName.styles[autoStyle]
    if (!template) {
      return
    }

    let changed = false
    let next = value

    // name 已命中模板而 style 为空时，自动补齐默认 style（只补一次）。
    if (!value.style) {
      next = { ...next, style: autoStyle }
      changed = true
    }

    if (next.kind !== template.kind) {
      next = { ...next, kind: template.kind }
      changed = true
    }

    const targetCount = template.childCount
    if (Number.isFinite(targetCount) && next.children.length !== targetCount) {
      const adjustedChildren = [...next.children]
      if (adjustedChildren.length < targetCount) {
        for (let i = adjustedChildren.length; i < targetCount; i += 1) {
          adjustedChildren.push({
            name: `arg${i + 1}`,
            style: '',
            kind: '',
            mdata: null,
            children: [],
          })
        }
      } else {
        adjustedChildren.splice(targetCount)
      }
      next = { ...next, children: adjustedChildren }
      changed = true
    }

    if (changed) {
      onChange(next)
    }
  }, [onChange, templateDb, value])

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
            value={value.name}
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
              updateNode({ name: e.target.value })
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
        <div className="tree-style-wrap">
          <span>[</span>
          <div className="tree-input-with-suggest">
            <input
              className={[
                'tree-style-input',
                styleMatched ? 'match-ok' : '',
                activeInput === 'style' && value.style.length > 0 && !styleMatched
                  ? 'match-fail'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              value={value.style}
              onFocus={() => {
                setActiveInput('style')
                setShowStyleSuggest(true)
              }}
              onBlur={() => {
                setActiveInput((prev) => (prev === 'style' ? null : prev))
                setTimeout(() => setShowStyleSuggest(false), 120)
              }}
              onChange={(e) => {
                setStyleSuggestIndex(0)
                setShowStyleSuggest(true)
                updateNode({ style: e.target.value })
              }}
              onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowStyleSuggest(false)
                return
              }
                if (!showStyleSuggest || styleSuggestions.length === 0) {
                  return
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setStyleSuggestIndex((prev) => (prev + 1) % styleSuggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setStyleSuggestIndex((prev) => (prev - 1 + styleSuggestions.length) % styleSuggestions.length)
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  applyStyleSuggestion()
                }
              }}
              placeholder="style"
            />
            {showStyleSuggest && styleSuggestions.length > 0 && (
              <ul className="tree-suggest-list tree-suggest-style">
                {styleSuggestions.map((candidate, index) => (
                  <li
                    key={candidate}
                    className={index === styleSuggestIndex ? 'active' : ''}
                    onMouseDown={() => applyStyleSuggestion(index)}
                  >
                    {candidate}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <span>]</span>
        </div>
      </div>

      <div className="tree-children">
        {value.children.map((child, index) => (
          <div key={`child-${index}`} className="tree-child-item">
            <OperatorTreeEditor
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
