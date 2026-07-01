/**
 * Built-in block renderers (`list` / `table` / `centered`). Each conforms to
 * {@link SnlBlockRenderer} and is registered in {@link defaultRenderers}.
 *
 * A block renderer receives the syntax-tree node, the macro DB, and a
 * `renderChild` callback that dispatches any child (math / text / block) back
 * through the view's mode-aware renderer.
 */
import { Fragment, type ReactElement } from 'react'
import type { SnlBlockRenderer } from './hooks'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

/** Render one child, tagging it with a stable key for React. */
function keyed(child: ReactElement, index: number): ReactElement {
  return <Fragment key={index}>{child}</Fragment>
}

/**
 * `list` renderer — variadic. Renders each child as a `<li>` inside a `<ul>`.
 * Children may be math, text, or nested block nodes; `renderChild` dispatches.
 */
export const ListRenderer: SnlBlockRenderer = ({ node, renderChild }) => (
  <ul className="snl-block snl-block-list">
    {node.children.map((child, index) => (
      <li key={index}>{renderChild(child)}</li>
    ))}
  </ul>
)

/** A row node is treated as a header row when its `kind` is `table-header`. */
function isHeaderRow(row: SnlSyntaxTree | undefined): boolean {
  return row?.kind === 'table-header'
}

/** Cells of a row: its children, or the row itself when it is a bare leaf. */
function rowCells(row: SnlSyntaxTree): SnlSyntaxTree[] {
  return row.children.length > 0 ? row.children : [row]
}

/**
 * `table` renderer — variadic. Children are row nodes (e.g. `matrix.row`).
 * If `children[0]` has `kind === "table-header"` it becomes the `<thead>`;
 * otherwise every row is rendered as a body row without a header.
 */
export const TableRenderer: SnlBlockRenderer = ({ node, renderChild }) => {
  const first = node.children[0]
  const hasHeader = isHeaderRow(first)
  const headerRow = hasHeader ? first : undefined
  const bodyRows = hasHeader ? node.children.slice(1) : node.children

  return (
    <table className="snl-block snl-block-table">
      {headerRow ? (
        <thead>
          <tr>
            {rowCells(headerRow).map((cell, index) => (
              <th key={index}>{renderChild(cell)}</th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {bodyRows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {rowCells(row).map((cell, cellIndex) => (
              <td key={cellIndex}>{renderChild(cell)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * `centered` renderer — variadic. Renders children in a horizontally centered
 * block container.
 */
export const CenteredRenderer: SnlBlockRenderer = ({ node, renderChild }) => (
  <div className="snl-block snl-block-centered" style={{ textAlign: 'center' }}>
    {node.children.map((child, index) => keyed(renderChild(child), index))}
  </div>
)
