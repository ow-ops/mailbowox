import ExpoModulesCore

public class BackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackupExclusion")

    // Marks a directory and the files in it. Apple notes that writing a file can clear the mark, so callers set it
    // again whenever the files may have been recreated.
    Function("exclude") { (path: String) in
      let directory = URL(fileURLWithPath: path, isDirectory: true)
      let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      for var url in [directory] + files {
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
      }
    }
  }
}
