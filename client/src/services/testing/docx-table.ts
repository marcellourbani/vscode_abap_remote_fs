import { BorderStyle, ITableCellOptions, ITableOptions, Table, TableCell } from "docx"

const singleLineBorder = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "000000",
  space: 0
} as const

const tableBorders = {
  top: singleLineBorder,
  bottom: singleLineBorder,
  left: singleLineBorder,
  right: singleLineBorder,
  insideHorizontal: singleLineBorder,
  insideVertical: singleLineBorder
}

const cellBorders = {
  top: singleLineBorder,
  bottom: singleLineBorder,
  start: singleLineBorder,
  end: singleLineBorder,
  left: singleLineBorder,
  right: singleLineBorder
}

export function borderedTable(options: ITableOptions): Table {
  return new Table({ ...options, borders: tableBorders })
}

export function borderedTableCell(options: ITableCellOptions): TableCell {
  return new TableCell({ ...options, borders: cellBorders })
}
