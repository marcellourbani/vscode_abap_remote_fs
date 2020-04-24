// copied from visual studio code as the jest can't resolve the js implementation
// can't find a better slution for now
export enum FileType {
  /**
   * The file type is unknown.
   */
  Unknown = 0,
  /**
   * A regular file.
   */
  File = 1,
  /**
   * A directory.
   */
  Directory = 2,
  /**
   * A symbolic link to a file.
   */
  SymbolicLink = 64
}

export class FileSystemError extends Error {
  static FileNotADirectory(messageOrUri?: string) {
    return new Error(messageOrUri)
  }
}
