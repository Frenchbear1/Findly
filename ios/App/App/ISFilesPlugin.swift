import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/// The library as real files: everything lives in the app's Documents folder, which the Files app shows as
/// "On My iPhone › Findly". Files dropped there (from Files, a Mac, or anything else that edits them) are
/// picked up the next time the app opens or comes back; files opened "in" Findly from other apps land there too.
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
        CAPPluginMethod(name: "moveTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeIncoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cloud", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCloud", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncNow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeSynced", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKnown", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "instantsearch.files", qos: .utility)
    private var incoming: [[String: Any]] = []
    private let fm = FileManager.default

    /// The library: iCloud Drive › Findly when iCloud sync is on (so every Apple device has the same documents),
    /// otherwise On My iPhone › Findly.
    private var local: URL { fm.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private let sync = ISCloudSync.shared // iCloud: the folder, what's in it, and taking documents in (ISCloudSync)
    private var cloudOn: Bool { sync.cloudOn }
    private var root: URL { cloudOn ? (sync.docsURL ?? local) : local }

    override public func load() {
        // make the folder show up in Files right away, with a note in it
        let readme = local.appendingPathComponent("Put documents here.txt")
        if !fm.fileExists(atPath: readme.path) {
            try? "Documents in this folder are your Findly library. Add, replace or delete PDFs, Word files, text, Markdown or HTML here and Findly picks up the changes when you open it.\n".write(to: readme, atomically: true, encoding: .utf8)
        }
        // the page hears about changes from iCloud and how far taking documents in has got
        sync.onChange = { [weak self] in self?.notifyListeners("changed", data: [:]) }
        sync.onProgress = { [weak self] d in self?.notifyListeners("synced", data: d) }
        // find the iCloud container (this can take a moment, so not on the main thread)
        queue.async {
            self.sync.findContainer()
            DispatchQueue.main.async { if self.cloudOn { self.sync.watch() } } // (the page starts the first sync)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(opened(_:)), name: .capacitorOpenURL, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(toBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func foreground() {
        notifyListeners("changed", data: [:])
    }

    /// A document opened "in" Findly from another app (share sheet, Files, Mail…): copy it into the library.
    @objc private func opened(_ note: Notification) {
        guard let info = note.object as? [String: Any], let url = info["url"] as? URL, url.isFileURL else { return }
        queue.async {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            var dest = url
            if !self.canon(url).hasPrefix(self.canon(self.root) + "/") || url.path.contains("/Inbox/") {
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

    /// The same place written one way: iOS hands out both /var/… and /private/var/… for the app's folders,
    /// and a file deep in a subfolder lost its folders when the two didn't match.
    private func canon(_ url: URL) -> String {
        var p = url.resolvingSymlinksInPath().standardizedFileURL.path
        if p.hasPrefix("/private/var/") { p = String(p.dropFirst(8)) }
        return p
    }
    private func rel(_ url: URL) -> String {
        let base = canon(root) + "/"
        let p = canon(url)
        return p.hasPrefix(base) ? String(p.dropFirst(base.count)) : url.lastPathComponent
    }

    private func at(_ path: String) -> URL? {
        sync.findContainer()
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
        run(call) { self.sync.findContainer(); return ["root": self.root.absoluteString] }
    }

    @objc func list(_ call: CAPPluginCall) {
        run(call) {
            self.sync.findContainer()
            // iCloud sync is on but iCloud isn't reachable (signed out, iCloud Drive off): don't report an empty
            // library, or the page would think every document was deleted
            if UserDefaults.standard.bool(forKey: ISCloudSync.cloudKey) && self.sync.docsURL == nil {
                throw NSError(domain: "ISFiles", code: 3, userInfo: [NSLocalizedDescriptionKey: "iCloud Drive isn't available right now"])
            }
            // iCloud: everything in iCloud Drive › Findly, whether it's on this device yet or not. Nothing is
            // downloaded from here (ISCloudSync asks for what's needed, once)
            if self.cloudOn {
                let (all, gathering) = self.sync.entries()
                var files: [[String: Any]] = [], waiting: [String] = [], sizes: [String: Int] = [:]
                for (path, e) in all {
                    let parts = path.split(separator: "/").map(String.init)
                    if parts.first == "Inbox" { continue }
                    if parts.enumerated().contains(where: { $0.element.hasPrefix(".") && !($0.offset == 0 && $0.element == ".findly") }) { continue }
                    if e.here { files.append(["path": path, "size": e.size, "mtime": e.mtime]) }
                    else { waiting.append(path); sizes[path] = e.size }
                }
                return ["files": files, "pending": waiting.count + (gathering ? 1 : 0), "waiting": waiting, "waitingSizes": sizes,
                        "handled": self.sync.handled(all), "gathering": gathering, "cloud": true]
            }
            var out: [[String: Any]] = []
            var pending = 0
            var waiting: [String] = [] // in iCloud, not on this device yet (being downloaded)
            let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
            if let walk = self.fm.enumerator(at: self.root, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants]) {
                for case let url as URL in walk {
                    let name = url.lastPathComponent
                    if name == "Inbox" { walk.skipDescendants(); continue }
                    // Findly's own folder (the library's organisation and each document's text, written by your other
                    // devices): walked like the rest so its files come down from iCloud too
                    if name == ".findly" && url.deletingLastPathComponent().standardizedFileURL.path == self.root.standardizedFileURL.path { continue }
                    if name.hasPrefix(".") {
                        // an iCloud file not on this device yet (".Name.pdf.icloud"): fetch it
                        if name.hasSuffix(".icloud") {
                            let real = url.deletingLastPathComponent().appendingPathComponent(String(name.dropFirst().dropLast(7)))
                            try? self.fm.startDownloadingUbiquitousItem(at: real)
                            pending += 1
                            waiting.append(self.rel(real))
                        } else if (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true { walk.skipDescendants() }
                        continue
                    }
                    guard let v = try? url.resourceValues(forKeys: Set(keys)), v.isRegularFile == true else { continue }
                    if v.isUbiquitousItem == true, let st = v.ubiquitousItemDownloadingStatus, st != .current {
                        try? self.fm.startDownloadingUbiquitousItem(at: url)
                        pending += 1
                        waiting.append(self.rel(url))
                        continue
                    }
                    out.append([
                        "path": self.rel(url),
                        "size": v.fileSize ?? 0,
                        "mtime": (v.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000,
                    ])
                }
            }
            return ["files": out, "pending": pending, "waiting": waiting, "cloud": false]
        }
    }

    // MARK: iCloud

    // (not behind the queue's file work; the first time it waits for iCloud to be found, or the page would start up
    // thinking iCloud sync was off)
    @objc func cloud(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            self.sync.findContainer()
            call.resolve(["available": self.sync.docsURL != nil, "on": self.cloudOn, "background": self.sync.backgroundOn])
        }
    }

    /// Turns iCloud sync on or off. Nothing is moved or copied: on, the library simply is the iCloud Drive › Findly
    /// folder (shared by all your Apple devices); off, it's On My iPhone › Findly again.
    @objc func setCloud(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        if on && sync.docsURL == nil { return call.reject("iCloud Drive isn't available. Sign in to iCloud and turn on iCloud Drive in Settings.") }
        UserDefaults.standard.set(on, forKey: ISCloudSync.cloudKey)
        DispatchQueue.main.async {
            if on { self.sync.watch() } else { self.sync.unwatch() } // (the page starts the sync once it's ready)
            self.sync.schedule()
        }
        call.resolve(["on": on])
    }

    /// "Sync in the background": iOS wakes Findly now and then to take in what your other devices added.
    @objc func setBackground(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        UserDefaults.standard.set(on, forKey: ISCloudSync.backgroundKey)
        DispatchQueue.main.async { self.sync.schedule() }
        call.resolve(["background": on])
    }

    /// Takes in what's new in iCloud now (it runs by itself too, whenever iCloud reports a change).
    @objc func syncNow(_ call: CAPPluginCall) {
        if cloudOn { sync.kick() }
        call.resolve()
    }

    /// Documents taken in from iCloud (their text is already in the search database) for the page to list:
    /// → { docs: [{ id, path, name, size, meta, lens, opening, order?, folderId?, enabled? }] }
    @objc func takeSynced(_ call: CAPPluginCall) {
        sync.takeInbox { call.resolve(["docs": $0]) }
    }

    /// { paths } — every document file the page has (or is reading): never taken in a second time.
    @objc func setKnown(_ call: CAPPluginCall) {
        sync.setKnown(call.getArray("paths", String.self) ?? [])
        call.resolve()
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

    /// Moves a file into a folder of the library (made if needed; "" is the top level), keeping its name unless
    /// that's taken there. Folders the move leaves empty go too, never the library folder itself.
    @objc func moveTo(_ call: CAPPluginCall) {
        guard let from = call.getString("from"), let src = at(from) else { return call.reject("bad path") }
        let folder = call.getString("folder") ?? ""
        guard let dir = folder.isEmpty ? root : at(folder) else { return call.reject("bad folder") }
        run(call) {
            let top = self.root.standardizedFileURL.path
            if src.deletingLastPathComponent().standardizedFileURL.path == dir.standardizedFileURL.path { return ["path": from] }
            guard self.fm.fileExists(atPath: src.path) else { throw NSError(domain: "ISFiles", code: 2, userInfo: [NSLocalizedDescriptionKey: "not on this device yet"]) }
            try self.fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = self.free(src.lastPathComponent, in: dir)
            try self.fm.moveItem(at: src, to: dest)
            var up = src.deletingLastPathComponent().standardizedFileURL
            while up.path != top && up.path.hasPrefix(top + "/") {
                let left = (try? self.fm.contentsOfDirectory(atPath: up.path))?.filter { $0 != ".DS_Store" } ?? ["?"]
                if !left.isEmpty { break }
                try? self.fm.removeItem(at: up)
                up = up.deletingLastPathComponent().standardizedFileURL
            }
            return ["path": self.rel(dest)]
        }
    }

    /// A piece of a file, as base64 (a big backup is read a few MB at a time).
    @objc func read(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = at(path) else { return call.reject("bad path") }
        let offset = UInt64(max(0, call.getDouble("offset") ?? 0))
        let length = max(0, call.getInt("length") ?? 0)
        run(call) {
            let h = try FileHandle(forReadingFrom: url)
            defer { try? h.close() }
            try h.seek(toOffset: offset)
            let data = try h.read(upToCount: length) ?? Data()
            return ["data": data.base64EncodedString()]
        }
    }

    @objc func stat(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = at(path) else { return call.reject("bad path") }
        run(call) {
            let a = try self.fm.attributesOfItem(atPath: url.path)
            return ["path": path, "size": (a[.size] as? NSNumber)?.intValue ?? 0]
        }
    }

    /// While a transfer runs: the screen doesn't lock, and if you switch apps iOS is asked for extra time to finish
    /// (iOS gives a little; if it runs out the transfer pauses and carries on when you come back).
    private var awake = false
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            self.awake = on
            UIApplication.shared.isIdleTimerDisabled = on
            if !on { self.endBackground() }
            call.resolve()
        }
    }
    @objc private func toBackground() {
        sync.schedule() // iOS wakes Findly later to keep the library in step with your other devices
        guard awake, bgTask == .invalid else { return }
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "Transfer") { [weak self] in self?.endBackground() }
    }
    private func endBackground() {
        if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
    }

    @objc func takeIncoming(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let items = self.incoming
            self.incoming = []
            call.resolve(["files": items])
        }
    }
}

// MARK: Adding documents (and whole folders) without loading them into the page
// Files and folders are picked with the system picker and copied into the library folder here, one file at a
// time, each one downloaded from iCloud first if it has to be. Nothing passes through the web page: it is told
// as each file lands (with how many are left) and reads it from the library folder in pieces, so a folder of any
// size comes in steadily while the app stays usable.
extension ISFilesPlugin: UIDocumentPickerDelegate {
    private static var pickCall: CAPPluginCall?
    private static var pickInto = ""
    private static let importQueue = DispatchQueue(label: "instantsearch.import", qos: .utility)
    private static let kinds: Set<String> = ["pdf", "docx", "txt", "text", "md", "markdown", "html", "htm", "mht", "mhtml", "rtf"]

    /// { folder: true to pick a whole folder, into: a folder of the library ("" for the top) } → { count }
    @objc func pick(_ call: CAPPluginCall) {
        let folder = call.getBool("folder") ?? false
        DispatchQueue.main.async {
            var types: [UTType] = [.pdf, .plainText, .html, .rtf]
            for e in ["docx", "md", "markdown", "mht", "mhtml"] { if let t = UTType(filenameExtension: e) { types.append(t) } }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: folder ? [.folder] : types, asCopy: false)
            picker.allowsMultipleSelection = !folder
            picker.delegate = self
            ISFilesPlugin.pickCall = call
            ISFilesPlugin.pickInto = call.getString("into") ?? ""
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        ISFilesPlugin.pickCall?.resolve(["count": 0])
        ISFilesPlugin.pickCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        ISFilesPlugin.pickCall?.resolve(["count": urls.count])
        ISFilesPlugin.pickCall = nil
        importPicked(urls, into: ISFilesPlugin.pickInto)
    }

    private func importPicked(_ urls: [URL], into: String) {
        ISFilesPlugin.importQueue.async {
            var scoped: [URL] = []
            var jobs: [(src: URL, dir: String)] = []
            for u in urls {
                if u.startAccessingSecurityScopedResource() { scoped.append(u) }
                if (try? u.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true {
                    // a folder: every document in it (and its subfolders), keeping its folders
                    var listed: [URL] = []
                    var err: NSError?
                    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: u, options: [.immediatelyAvailableMetadataOnly], error: &err) { dir in
                        if let walk = self.fm.enumerator(at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsPackageDescendants]) {
                            for case let f as URL in walk { listed.append(f) }
                        }
                    }
                    let base = self.canon(u)
                    for f in listed {
                        var name = f.lastPathComponent
                        var src = f
                        if name.hasPrefix(".") {
                            guard name.hasSuffix(".icloud") else { continue } // hidden files
                            name = String(name.dropFirst().dropLast(7)) // in iCloud, not on this device yet
                            src = f.deletingLastPathComponent().appendingPathComponent(name)
                        }
                        guard ISFilesPlugin.kinds.contains((name as NSString).pathExtension.lowercased()) else { continue }
                        let parent = self.canon(src.deletingLastPathComponent())
                        let sub = parent.hasPrefix(base) ? String(parent.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/")) : ""
                        let dir = [into, u.lastPathComponent, sub].filter { !$0.isEmpty }.joined(separator: "/")
                        jobs.append((src: src, dir: dir))
                    }
                } else {
                    jobs.append((src: u, dir: into))
                }
            }
            let total = jobs.count
            self.announce(["done": 0, "total": total])
            for (i, job) in jobs.enumerated() {
                autoreleasepool {
                    // already in the library folder (picked from iCloud Drive › Findly itself): nothing to copy,
                    // it's simply read where it is
                    if self.canon(job.src).hasPrefix(self.canon(self.root) + "/") {
                        self.announce(["done": i + 1, "total": total, "name": job.src.lastPathComponent, "path": self.rel(job.src)])
                        return
                    }
                    let dir = job.dir.isEmpty ? self.root : self.root.appendingPathComponent(job.dir, isDirectory: true)
                    try? self.fm.createDirectory(at: dir, withIntermediateDirectories: true)
                    let name = job.src.lastPathComponent
                    var dest = dir.appendingPathComponent(name)
                    var copied = false
                    var err: NSError?
                    // (reading through the coordinator downloads it from iCloud first if it has to)
                    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: job.src, options: [.withoutChanges], error: &err) { src in
                        if self.fm.fileExists(atPath: dest.path) {
                            let a = (try? src.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, b = (try? dest.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
                            if a != nil && a == b { return } // already in the library
                            dest = self.free(name, in: dir)
                        }
                        copied = (try? self.fm.copyItem(at: src, to: dest)) != nil
                    }
                    self.announce(["done": i + 1, "total": total, "name": name, "path": copied ? self.rel(dest) : ""])
                }
            }
            for u in scoped { u.stopAccessingSecurityScopedResource() }
        }
    }

    private func announce(_ data: [String: Any]) {
        DispatchQueue.main.async { self.notifyListeners("imported", data: data) }
    }
}

