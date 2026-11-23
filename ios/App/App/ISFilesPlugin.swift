import Foundation
import Capacitor
import UIKit

/// The library as real files: everything lives in the app's Documents folder, which the Files app shows as
/// "On My iPhone › Instant Search". Files dropped there (from Files, a Mac, or anything else that edits them) are
/// picked up the next time the app opens or comes back; files opened "in" Instant Search from other apps land there too.
/// Paths given to the web side are relative to that folder.
@objc(ISFilesPlugin)
public class ISFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ISFilesPlugin"
    public let jsName = "ISFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "freeName", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rename", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeIncoming", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "instantsearch.files", qos: .utility)
    private var incoming: [[String: Any]] = []
    private let fm = FileManager.default

    private var root: URL {
        let url = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return url
    }

    override public func load() {
        // make the folder show up in Files right away, with a note in it
        let readme = root.appendingPathComponent("Put documents here.txt")
        if !fm.fileExists(atPath: readme.path) {
            try? "Documents in this folder are your Instant Search library. Add, replace or delete PDFs, Word files, text, Markdown or HTML here and Instant Search picks up the changes when you open it.\n".write(to: readme, atomically: true, encoding: .utf8)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(opened(_:)), name: .capacitorOpenURL, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func foreground() {
        notifyListeners("changed", data: [:])
    }

    /// A document opened "in" Instant Search from another app (share sheet, Files, Mail…): copy it into the library.
    @objc private func opened(_ note: Notification) {
        guard let info = note.object as? [String: Any], let url = info["url"] as? URL, url.isFileURL else { return }
        queue.async {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            var dest = url
            if !url.standardizedFileURL.path.hasPrefix(self.root.standardizedFileURL.path + "/") || url.path.contains("/Inbox/") {
                dest = self.free(url.lastPathComponent)
                var coordError: NSError?
                NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordError) { src in
                    try? self.fm.copyItem(at: src, to: dest)
                }
                if url.path.contains("/Inbox/") { try? self.fm.removeItem(at: url) }
            }
            guard self.fm.fileExists(atPath: dest.path) else { return }
            let item: [String: Any] = ["path": self.rel(dest)]
            DispatchQueue.main.async {
                self.incoming.append(item)
                self.notifyListeners("incoming", data: ["files": [item]])
            }
        }
    }

    private func rel(_ url: URL) -> String {
        let base = root.standardizedFileURL.path + "/"
        let p = url.standardizedFileURL.path
        return p.hasPrefix(base) ? String(p.dropFirst(base.count)) : url.lastPathComponent
    }

    private func at(_ path: String) -> URL? {
        let url = root.appendingPathComponent(path).standardizedFileURL
        return url.path.hasPrefix(root.standardizedFileURL.path + "/") ? url : nil
    }

    /// A name in the library folder that isn't taken yet: "Name.pdf", "Name 2.pdf"…
    private func free(_ name: String, in dir: URL? = nil) -> URL {
        let folder = dir ?? root
        let clean = name.replacingOccurrences(of: "/", with: "-")
        var url = folder.appendingPathComponent(clean)
        let ext = url.pathExtension, base = url.deletingPathExtension().lastPathComponent
        var n = 2
        while fm.fileExists(atPath: url.path) {
            url = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return url
    }

    private func run(_ call: CAPPluginCall, _ work: @escaping () throws -> [String: Any]) {
        queue.async {
            do { call.resolve(try work()) } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func info(_ call: CAPPluginCall) {
        run(call) { ["root": self.root.absoluteString] }
    }

    @objc func list(_ call: CAPPluginCall) {
        run(call) {
            var out: [[String: Any]] = []
            let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey, .isUbiquitousItemKey]
            if let walk = self.fm.enumerator(at: self.root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants]) {
                for case let url as URL in walk {
                    if url.lastPathComponent == "Inbox" { walk.skipDescendants(); continue }
                    guard let v = try? url.resourceValues(forKeys: Set(keys)), v.isRegularFile == true else { continue }
                    out.append([
                        "path": self.rel(url),
                        "size": v.fileSize ?? 0,
                        "mtime": (v.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000,
                    ])
                }
            }
            return ["files": out]
        }
    }

    /// Writes base64 data to a path in the library, in pieces (append) so big files never cross the bridge at once.
    @objc func write(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = at(path) else { return call.reject("bad path") }
        let append = call.getBool("append") ?? false
        let b64 = call.getString("data") ?? ""
        run(call) {
            guard let data = Data(base64Encoded: b64) else { throw NSError(domain: "ISFiles", code: 1, userInfo: [NSLocalizedDescriptionKey: "bad data"]) }
            try self.fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if append, self.fm.fileExists(atPath: url.path) {
                let h = try FileHandle(forWritingTo: url)
                defer { try? h.close() }
                try h.seekToEnd()
                try h.write(contentsOf: data)
            } else {
                try data.write(to: url)
            }
            return ["path": self.rel(url)]
        }
    }

    @objc func freeName(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "Document"
        let folder = call.getString("folder").flatMap { $0.isEmpty ? nil : self.at($0) }
        run(call) {
            if let folder { try self.fm.createDirectory(at: folder, withIntermediateDirectories: true) }
            return ["path": self.rel(self.free(name, in: folder))]
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = at(path) else { return call.reject("bad path") }
        run(call) {
            if self.fm.fileExists(atPath: url.path) { try self.fm.removeItem(at: url) }
            return [:]
        }
    }

    @objc func rename(_ call: CAPPluginCall) {
        guard let from = call.getString("from"), let src = at(from), let name = call.getString("name") else { return call.reject("bad path") }
        run(call) {
            let dest = self.free(name, in: src.deletingLastPathComponent())
            try self.fm.moveItem(at: src, to: dest)
            return ["path": self.rel(dest)]
        }
    }

    @objc func takeIncoming(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let items = self.incoming
            self.incoming = []
            call.resolve(["files": items])
        }
    }
}
