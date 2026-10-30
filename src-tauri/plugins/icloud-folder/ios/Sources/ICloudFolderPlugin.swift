// The Reading Room on iPhone and iPad: syncing through a folder in iCloud Drive.
// Pick the folder once in Apple's Files picker; a bookmark keeps the app's access to it after restarts.

import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

struct BookmarkArgs: Decodable {
  let bookmark: String
}

struct PathArgs: Decodable {
  let path: String
}

class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
  var done: ((URL?) -> Void)?

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    done?(urls.first)
    done = nil
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    done?(nil)
    done = nil
  }
}

class ICloudFolderPlugin: Plugin {
  let pickerDelegate = FolderPickerDelegate()
  let speaker = ArticleSpeaker()

  @objc public func pickFolder(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder], asCopy: false)
      picker.allowsMultipleSelection = false
      picker.delegate = self.pickerDelegate
      self.pickerDelegate.done = { url in
        guard let url = url else {
          invoke.resolve(["cancelled": true])
          return
        }
        _ = url.startAccessingSecurityScopedResource()
        do {
          let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
          invoke.resolve(["path": url.path, "bookmark": data.base64EncodedString()])
        } catch {
          invoke.reject("Couldn't keep access to that folder: \(error.localizedDescription)")
        }
      }
      self.manager.viewController?.present(picker, animated: true, completion: nil)
    }
  }

  @objc public func openBookmark(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BookmarkArgs.self)
    guard let data = Data(base64Encoded: args.bookmark) else {
      invoke.reject("The remembered sync folder is damaged. Choose it again.")
      return
    }
    var stale = false
    do {
      let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
      _ = url.startAccessingSecurityScopedResource()
      var keep = args.bookmark
      if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
        keep = fresh.base64EncodedString()
      }
      invoke.resolve(["path": url.path, "bookmark": keep])
    } catch {
      invoke.reject("The sync folder can't be opened. Choose it again. (\(error.localizedDescription))")
    }
  }

  /// Ask iCloud for the newest copy of every sync file in the folder, then wait (up to 20 seconds) for them.
  @objc public func download(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    DispatchQueue.global(qos: .utility).async {
      let dir = URL(fileURLWithPath: args.path, isDirectory: true)
      let fm = FileManager.default
      let names = (try? fm.contentsOfDirectory(atPath: args.path)) ?? []
      var files: [URL] = []
      for name in names {
        if name.hasPrefix(".") && name.hasSuffix(".json.icloud") {
          // A placeholder for a file iCloud hasn't downloaded yet: ".<name>.json.icloud"
          files.append(dir.appendingPathComponent(String(name.dropFirst().dropLast(".icloud".count))))
        } else if name.hasSuffix(".json") && !name.hasPrefix(".") {
          files.append(dir.appendingPathComponent(name))
        }
      }
      for url in files {
        try? fm.startDownloadingUbiquitousItem(at: url)
      }
      // A coordinated read waits until iCloud has the file on this device.
      let group = DispatchGroup()
      for url in files {
        group.enter()
        DispatchQueue.global(qos: .utility).async {
          var error: NSError?
          NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &error) { _ in }
          group.leave()
        }
      }
      _ = group.wait(timeout: .now() + 20)
      invoke.resolve(["files": files.count])
    }
  }

  @objc public func deviceName(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      invoke.resolve(["name": UIDevice.current.name])
    }
  }
}

@_cdecl("init_plugin_icloud_folder")
public func initPlugin() -> Plugin {
  return ICloudFolderPlugin()
}
