import { readFileSync } from "node:fs"
import { join } from "node:path"
import { loadPayload, ENGINE_VERSION } from "./payload"

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Small deterministic ZIP writer (stored entries). No extra runtime dependency for three sources. */
export function zipFiles(files: Record<string, string>): Buffer {
  const entries: Buffer[] = [],
    directory: Buffer[] = []
  let offset = 0
  for (const [filename, text] of Object.entries(files)) {
    if (
      !/^[\w.-]+(?:\/[\w.-]+)*$/.test(filename) ||
      filename.split("/").some(part => part === "." || part === "..")
    )
      throw new Error("Invalid archive path")
    const name = Buffer.from(filename),
      data = Buffer.from(text),
      crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(33, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    entries.push(header, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(33, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += header.length + name.length + data.length
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(directory.length / 2, 8)
  end.writeUInt16LE(directory.length / 2, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...entries, central, end])
}

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
function objectXml(serializer: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>${body}</asx:values></asx:abap></abapGit>\n`
}
export function archiveFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {
    ".abapgit.xml": `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><MASTER_LANGUAGE>E</MASTER_LANGUAGE><STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>PREFIX</FOLDER_LOGIC></DATA></asx:values></asx:abap>`,
    LICENSE: readFileSync(join(directory, "LICENSE"), "utf8"),
    "README.md": readFileSync(join(directory, "GUIDE.md"), "utf8"),
    "version.txt": ENGINE_VERSION
  }
  for (const object of loadPayload(directory)) {
    const kind = object.type === "CLAS/OC" ? "clas" : "prog"
    const base = `src/${object.file}.${kind}`
    files[`${base}.abap`] = object.source
    files[`${base}.xml`] =
      kind === "clas"
        ? objectXml(
            "LCL_OBJECT_CLAS",
            `<VSEOCLASS><CLSNAME>${xml(object.name)}</CLSNAME><LANGU>E</LANGU><DESCRIPT>ABAP FS Customizing</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE></VSEOCLASS>`
          )
        : objectXml(
            "LCL_OBJECT_PROG",
            `<PROGDIR><NAME>${xml(object.name)}</NAME><SUBC>1</SUBC><FIXPT>X</FIXPT><UCCHECK>X</UCCHECK></PROGDIR>`
          )
  }
  return files
}
export function buildAbapGitArchive(directory: string): Buffer {
  return zipFiles(archiveFiles(directory))
}
