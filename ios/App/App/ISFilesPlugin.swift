import Foundation
import Capacitor
import UIKit

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
        CAPPluginMethod(name: "takeIncoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cloud", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCloud", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "instantsearch.files", qos: .utility)
    private var incoming: [[String: Any]] = []
    private let fm = FileManager.default

    /// The library: iCloud Drive › Findly when iCloud sync is on (so every Apple device has the same documents),
    /// otherwise On My iPhone › Findly.
    private var local: URL { fm.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private var cloudDocs: URL?
    private let cloudKey = "instantsearch.icloud"
    private var cloudOn: Bool { UserDefaults.standard.bool(forKey: cloudKey) && cloudDocs != nil }
    private var root: URL { cloudOn ? cloudDocs! : local }
    private var query: NSMetadataQuery?
    private var changeTimer: Timer?

    override public func load() {
        // make the folder show up in Files right away, with a note in it
        let readme = local.appendingPathComponent("Put documents here.txt")
        if !fm.fileExists(atPath: readme.path) {
            try? "Documents in this folder are your Findly library. Add, replace or delete PDFs, Word files, text, Markdown or HTML here and Findly picks up the changes when you open it.\n".write(to: readme, atomically: true, encoding: .utf8)
        }
        // find the iCloud container (this can take a moment, so not on the main thread)
        queue.async {
            if let c = self.fm.url(forUbiquityContainerIdentifier: nil) {
                let docs = c.appendingPathComponent("Documents", isDirectory: true)
                try? self.fm.createDirectory(at: docs, withIntermediateDirectories: true)
                self.cloudDocs = docs
                DispatchQueue.main.async { if self.cloudOn { self.watchCloud() } }
            }
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
            // iCloud sync is on but iCloud isn't reachable (signed out, iCloud Drive off): don't report an empty
            // library, or the page would think every document was deleted
            if UserDefaults.standard.bool(forKey: self.cloudKey) && self.cloudDocs == nil {
                throw NSError(domain: "ISFiles", code: 3, userInfo: [NSLocalizedDescriptionKey: "iCloud Drive isn't available right now"])
            }
            var out: [[String: Any]] = []
            var pending = 0
            var waiting: [String] = [] // in iCloud, not on this device yet (being downloaded)
            let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]
            if let walk = self.fm.enumerator(at: self.root, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants]) {
                for case let url as URL in walk {
                    let name = url.lastPathComponent
                    if name == "Inbox" { walk.skipDescendants(); continue }
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
            return ["files": out, "pending": pending, "waiting": waiting, "cloud": self.cloudOn]
        }
    }

    // MARK: iCloud

    @objc func cloud(_ call: CAPPluginCall) {
        run(call) { ["available": self.cloudDocs != nil, "on": self.cloudOn] }
    }

    /// Turns iCloud sync on (this device's documents move into iCloud Drive › Findly, joining any already there from
    /// your other devices) or off (the documents are copied back onto this device; iCloud keeps its copy for the others).
    @objc func setCloud(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        run(call) {
            guard let cloud = self.cloudDocs else { throw NSError(domain: "ISFiles", code: 2, userInfo: [NSLocalizedDescriptionKey: "iCloud Drive isn't available. Sign in to iCloud and turn on iCloud Drive in Settings."]) }
            if on == self.cloudOn { return ["on": on] }
            let from = on ? self.local : cloud, to = on ? cloud : self.local
            let items = (try? self.fm.contentsOfDirectory(at: from, includingPropertiesForKeys: [.fileSizeKey], options: [])) ?? []
            for src in items {
                let name = src.lastPathComponent
                if name == "Inbox" || name == ".transfer" || name.hasSuffix(".icloud") { continue }
                var dest = to.appendingPathComponent(name)
                if self.fm.fileExists(atPath: dest.path) {
                    // the same document from another device: keep one
                    let a = (try? src.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, b = (try? dest.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
                    if a == b || name.hasPrefix(".") { if on { try? self.fm.removeItem(at: src) }; continue }
                    dest = self.free(name, in: to)
                }
                if on { try self.fm.setUbiquitous(true, itemAt: src, destinationURL: dest) }
                else { try? self.fm.copyItem(at: src, to: dest) }
            }
            UserDefaults.standard.set(on, forKey: self.cloudKey)
            DispatchQueue.main.async { on ? self.watchCloud() : self.stopCloud() }
            return ["on": on]
        }
    }

    /// Changes made on your other devices arrive through iCloud: tell the page so it picks them up.
    private func watchCloud() {
        guard query == nil else { return }
        let q = NSMetadataQuery()
        q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        q.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
        NotificationCenter.default.addObserver(self, selector: #selector(cloudChanged), name: .NSMetadataQueryDidUpdate, object: q)
        NotificationCenter.default.addObserver(self, selector: #selector(cloudChanged), name: .NSMetadataQueryDidFinishGathering, object: q)
        q.start()
        query = q
    }
    private func stopCloud() {
        query?.stop()
        query = nil
    }
    @objc private func cloudChanged() {
        changeTimer?.invalidate()
        changeTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in self?.notifyListeners("changed", data: [:]) }
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
