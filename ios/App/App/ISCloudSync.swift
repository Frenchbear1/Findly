import Foundation
import UIKit
import BackgroundTasks
import SQLite3

/// iCloud sync, done by the app itself rather than by the web page.
///
/// With iCloud sync on, the library simply is iCloud Drive › Findly. Every device that adds a document also leaves
/// the text it read from it next to it (.findly/index/<name>.json). A device that's new to a document doesn't read
/// the PDF at all: it takes that small text file straight into its search database here, natively, one document at
/// a time, and hands the page a short list of what's ready. Nothing big crosses into the web page, nothing is
/// copied, and none of it waits for the PDFs themselves (they come down from iCloud on their own, and a page that's
/// opened before its PDF arrives is fetched there and then).
///
/// It runs whenever iCloud reports a change while the app is open, and, with "Sync in the background" on, when iOS
/// wakes Findly in the background, so the library is usually up to date before you open it.
final class ISCloudSync: NSObject {
    static let shared = ISCloudSync()

    static let refreshTask = "com.davidlabarre.instantsearch.sync"
    static let processingTask = "com.davidlabarre.instantsearch.sync.long"
    static let cloudKey = "instantsearch.icloud"
    static let backgroundKey = "findly.backgroundSync"
    static let kinds: Set<String> = ["pdf", "docx", "txt", "text", "md", "markdown", "html", "htm", "mht", "mhtml", "rtf"]
    static let sideDir = ".findly/index/"
    static let stateFile = ".findly/library.json"

    struct Entry { var path: String; var url: URL; var size: Int; var here: Bool; var mtime: Double }

    private let fm = FileManager.default
    private let work = DispatchQueue(label: "findly.cloudsync", qos: .utility)
    private let lock = NSLock()

    // iCloud Drive › Findly (nil until found, or when iCloud Drive is off)
    private var _docs: URL?
    private var looked = false
    var docsURL: URL? { lock.lock(); defer { lock.unlock() }; return _docs }

    var cloudOn: Bool { UserDefaults.standard.bool(forKey: Self.cloudKey) && docsURL != nil }
    var backgroundOn: Bool { UserDefaults.standard.object(forKey: Self.backgroundKey) as? Bool ?? true }

    /// The page is told: something in the folder changed / how far the sync has got.
    var onChange: (() -> Void)?
    var onProgress: (([String: Any]) -> Void)?

    // MARK: finding iCloud Drive › Findly

    /// Looks up the iCloud container once (this can take a moment: never on the main thread).
    func findContainer() {
        lock.lock()
        if looked { lock.unlock(); return }
        lock.unlock()
        var found: URL?
        if let c = fm.url(forUbiquityContainerIdentifier: nil) {
            let d = c.appendingPathComponent("Documents", isDirectory: true)
            try? fm.createDirectory(at: d, withIntermediateDirectories: true)
            found = d
        }
        lock.lock(); _docs = found; looked = true; lock.unlock()
    }

    // MARK: what iCloud knows is in the folder (on this device or not)

    private var query: NSMetadataQuery? // main thread only
    private var watching = false // (under lock)
    private var snap: [String: Entry] = [:] // rel path -> entry
    private var gathering = true
    private var signature = 0
    private var changeTimer: Timer?

    /// Starts listening to iCloud (main thread).
    func watch() {
        guard query == nil, cloudOn else { return }
        let q = NSMetadataQuery()
        q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        q.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
        q.notificationBatchingInterval = 2 // a big download sends thousands of updates: take them in batches
        NotificationCenter.default.addObserver(self, selector: #selector(updated), name: .NSMetadataQueryDidUpdate, object: q)
        NotificationCenter.default.addObserver(self, selector: #selector(updated), name: .NSMetadataQueryDidFinishGathering, object: q)
        query = q
        lock.lock(); watching = true; lock.unlock()
        q.start()
    }
    func unwatch() {
        query?.stop()
        if let q = query { NotificationCenter.default.removeObserver(self, name: nil, object: q) }
        query = nil
        lock.lock(); snap = [:]; gathering = true; signature = 0; watching = false; lock.unlock()
    }

    @objc private func updated() {
        guard let q = query, let root = docsURL else { return }
        q.disableUpdates()
        var out: [String: Entry] = [:]
        var sig = 0
        for i in 0..<q.resultCount {
            guard let item = q.result(at: i) as? NSMetadataItem, let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else { continue }
            if (item.value(forAttribute: NSMetadataItemContentTypeKey) as? String) == "public.folder" { continue }
            guard let path = rel(url, root) else { continue }
            let size = (item.value(forAttribute: NSMetadataItemFSSizeKey) as? NSNumber)?.intValue ?? 0
            let here = (item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String) == NSMetadataUbiquitousItemDownloadingStatusCurrent
            let date = (item.value(forAttribute: NSMetadataItemFSContentChangeDateKey) as? Date) ?? Date()
            out[path] = Entry(path: path, url: url, size: size, here: here, mtime: date.timeIntervalSince1970 * 1000)
            var h = Hasher(); h.combine(path); h.combine(size); h.combine(here)
            sig = sig &+ h.finalize()
        }
        let stillGathering = q.isGathering
        q.enableUpdates()
        lock.lock()
        let changed = sig != signature || gathering != stillGathering
        snap = out; gathering = stillGathering; signature = sig
        lock.unlock()
        // only when something the library cares about changed (a file came, went, changed size or finished
        // downloading), and not more than every few seconds
        guard changed else { return }
        changeTimer?.invalidate()
        changeTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { [weak self] _ in
            self?.onChange?()
            self?.kick()
        }
    }

    /// Everything in the folder: what iCloud reports plus what's on disk (whichever knows more).
    func entries() -> (items: [String: Entry], gathering: Bool) {
        guard let root = docsURL else { return ([:], false) }
        lock.lock()
        var all = snap
        let g = watching && gathering
        lock.unlock()
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey, .isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .isDirectoryKey]
        guard let walk = fm.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsPackageDescendants]) else { return (all, g) }
        for case let url as URL in walk {
            let name = url.lastPathComponent
            if name == "Inbox" { walk.skipDescendants(); continue }
            if name == ".findly" { continue } // Findly's own folder: walked like the rest
            if name.hasPrefix(".") {
                if name.hasSuffix(".icloud") { // an older iOS's stand-in for a file not on this device yet
                    let real = url.deletingLastPathComponent().appendingPathComponent(String(name.dropFirst().dropLast(7)))
                    guard let path = rel(real, root), all[path] == nil else { continue }
                    all[path] = Entry(path: path, url: real, size: placeholderSize(url), here: false, mtime: 0)
                } else if (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true { walk.skipDescendants() }
                continue
            }
            guard let v = try? url.resourceValues(forKeys: Set(keys)), v.isRegularFile == true, let path = rel(url, root) else { continue }
            let here = v.isUbiquitousItem != true || v.ubiquitousItemDownloadingStatus == .current
            if let known = all[path], known.here || !here { continue }
            all[path] = Entry(path: path, url: url, size: v.fileSize ?? 0, here: here, mtime: (v.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000)
        }
        return (all, g)
    }

    private func placeholderSize(_ url: URL) -> Int {
        guard let d = try? Data(contentsOf: url),
              let p = try? PropertyListSerialization.propertyList(from: d, options: [], format: nil) as? [String: Any] else { return 0 }
        return (p["NSURLFileSizeKey"] as? NSNumber)?.intValue ?? 0
    }

    private func canon(_ url: URL) -> String {
        var p = url.resolvingSymlinksInPath().standardizedFileURL.path
        if p.hasPrefix("/private/var/") { p = String(p.dropFirst(8)) }
        return p
    }
    // (no disk access per file: the folder's own path is worked out once, and iCloud's paths only differ from it by
    // a leading /private)
    private var baseFor: (root: URL, base: String)?
    private func rel(_ url: URL, _ root: URL) -> String? {
        lock.lock()
        var base = baseFor?.root == root ? baseFor!.base : nil
        lock.unlock()
        if base == nil {
            base = canon(root) + "/"
            lock.lock(); baseFor = (root, base!); lock.unlock()
        }
        var p = url.standardizedFileURL.path
        if p.hasPrefix("/private/var/") { p = String(p.dropFirst(8)) }
        return p.hasPrefix(base!) ? String(p.dropFirst(base!.count)) : nil
    }

    /// The text file another device left for a document (same naming as the page's sideKey()).
    static func sideKey(_ name: String) -> String {
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|").union(CharacterSet(charactersIn: Unicode.Scalar(UInt8(0))...Unicode.Scalar(UInt8(0x1f))))
        var safe = String.UnicodeScalarView()
        for u in name.unicodeScalars { safe.append(bad.contains(u) ? Unicode.Scalar(UInt8(0x2d)) : u) }
        return sideDir + String(safe) + ".json"
    }
    static func isDocument(_ path: String) -> Bool {
        let parts = path.split(separator: "/").map(String.init)
        guard let name = parts.last, parts.first != "Inbox", parts.first != "Backups", parts.first != ".findly" else { return false }
        if parts.contains(where: { $0.hasPrefix(".") }) || name == "Put documents here.txt" { return false }
        return kinds.contains((name as NSString).pathExtension.lowercased())
    }

    // MARK: what the page already has, and what's ready for it

    private let support: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    // these small files are read and written from more than one thread (the sync runs for minutes; the page takes
    // what's ready meanwhile), so one at a time
    private let fileLock = NSLock()
    private var knownURL: URL { support.appendingPathComponent("findly-cloud-known.json") }
    private var inboxURL: URL { support.appendingPathComponent("findly-cloud-inbox.json") }
    private var rejectedURL: URL { support.appendingPathComponent("findly-cloud-rejected.json") }

    private func readJSON<T>(_ url: URL, _ fallback: T) -> T {
        guard let d = try? Data(contentsOf: url), let v = try? JSONSerialization.jsonObject(with: d) as? T else { return fallback }
        return v
    }
    private func writeJSON(_ url: URL, _ v: Any) {
        if let d = try? JSONSerialization.data(withJSONObject: v) { try? d.write(to: url, options: .atomic) }
    }

    /// The paths the page has in its library (or is reading right now): never taken in twice.
    func setKnown(_ paths: [String]) {
        fileLock.lock(); defer { fileLock.unlock() }
        // (anything handed over but not listed yet stays known too)
        let inbox: [[String: Any]] = readJSON(inboxURL, [])
        writeJSON(knownURL, paths + inbox.compactMap { $0["path"] as? String })
    }
    /// Documents taken in and waiting for the page to add them; what's handed over counts as known from now on.
    func takeInbox(_ done: @escaping ([[String: Any]]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            self.fileLock.lock()
            let items: [[String: Any]] = self.readJSON(self.inboxURL, [])
            if !items.isEmpty {
                var known: [String] = self.readJSON(self.knownURL, [])
                known.append(contentsOf: items.compactMap { $0["path"] as? String })
                self.writeJSON(self.knownURL, known)
                try? self.fm.removeItem(at: self.inboxURL)
            }
            self.fileLock.unlock()
            done(items)
        }
    }
    private func addToInbox(_ item: [String: Any]) {
        fileLock.lock(); defer { fileLock.unlock() }
        var inbox: [[String: Any]] = readJSON(inboxURL, [])
        inbox.append(item)
        writeJSON(inboxURL, inbox)
    }
    /// Documents with a text file from another device (being taken in here, or about to be): the page leaves
    /// these alone rather than reading the PDF itself.
    func handled(_ all: [String: Entry]) -> [String] {
        fileLock.lock()
        let rejected: [String: String] = readJSON(rejectedURL, [:])
        fileLock.unlock()
        var out: [String] = []
        for (path, e) in all where Self.isDocument(path) {
            let name = (path as NSString).lastPathComponent
            guard let side = all[Self.sideKey(name)] else { continue }
            if rejected[path] == Self.mark(e, side) { continue }
            out.append(path)
        }
        return out
    }

    /// A document and its text file as they are now (a text file that didn't fit is tried again once either changes).
    static func mark(_ doc: Entry, _ side: Entry) -> String { "\(doc.size)/\(side.size)/\(Int(side.mtime))" }

    // MARK: taking documents in

    private var cancelled = false
    private var askedDownload = Set<String>()
    private var bgTask: UIBackgroundTaskIdentifier = .invalid // main thread only

    private func endBackgroundTask() {
        if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
    }

    /// Runs a sync soon. One at a time, and however many times it's asked for meanwhile, one more run covers them.
    private var queued = false // (under lock)
    func kick() {
        lock.lock()
        if queued { lock.unlock(); return }
        queued = true
        lock.unlock()
        work.async {
            self.lock.lock(); self.queued = false; self.lock.unlock()
            self.cancelled = false
            // switching apps mid-document: iOS gives a little time to finish it
            DispatchQueue.main.sync {
                if self.bgTask != .invalid { return }
                self.bgTask = UIApplication.shared.beginBackgroundTask(withName: "iCloud sync") { [weak self] in
                    self?.cancelled = true
                    self?.endBackgroundTask()
                }
            }
            self.runOnce()
            DispatchQueue.main.async { self.endBackgroundTask() }
        }
    }

    /// One pass: every document with a text file that this device doesn't have yet is taken in, one at a time.
    /// Returns whether there's more on its way (text files or the library file still downloading). Work queue only.
    @discardableResult private func runOnce() -> Bool {
        guard cloudOn else { return false }
        // not until the page has said what it already has (the first start of this version): otherwise a device
        // that already has every document would take them all in again
        fileLock.lock()
        let started = fm.fileExists(atPath: knownURL.path)
        let known = Set(readJSON(knownURL, [] as [String]))
        let waiting = Set((readJSON(inboxURL, [] as [[String: Any]])).compactMap { $0["path"] as? String })
        var rejected: [String: String] = readJSON(rejectedURL, [:])
        fileLock.unlock()
        guard started else { return false }
        let (all, stillGathering) = entries()
        var more = stillGathering

        // the library's order and folders, as your other devices have them
        var state: [String: Any] = [:]
        if let s = all[Self.stateFile] {
            if s.here {
                state = (try? Data(contentsOf: s.url)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            } else {
                // it's tiny and decides the order: wait for it
                try? fm.startDownloadingUbiquitousItem(at: s.url)
                return true
            }
        }
        let placed = state["docs"] as? [String: [String: Any]] ?? [:]

        var todo: [(doc: Entry, side: Entry)] = []
        for (path, e) in all where Self.isDocument(path) && !known.contains(path) && !waiting.contains(path) {
            guard let side = all[Self.sideKey((path as NSString).lastPathComponent)] else { continue }
            if rejected[path] == Self.mark(e, side) { continue }
            if !side.here { // the text file is on its way: asked for now, taken in when it's here
                try? fm.startDownloadingUbiquitousItem(at: side.url)
                more = true
                continue
            }
            todo.append((e, side))
        }
        // in the order your other devices have them, then by name
        let order = { (p: String) -> Double in (placed[p]?["order"] as? NSNumber)?.doubleValue ?? .infinity }
        todo.sort { a, b in
            let x = order(a.doc.path), y = order(b.doc.path)
            return x != y ? x < y : a.doc.path.localizedStandardCompare(b.doc.path) == .orderedAscending
        }

        let total = todo.count
        var done = 0
        if total > 0 { progress(["done": 0, "total": total]) }
        for job in todo {
            if cancelled { return true }
            autoreleasepool {
                switch ingest(job.side.url, doc: job.doc, placed: placed[job.doc.path]) {
                case .ok(let item):
                    addToInbox(item)
                    done += 1
                    progress(["done": done, "total": total, "name": (job.doc.path as NSString).lastPathComponent])
                case .unusable:
                    // not this version's text (or not readable text): the page reads this document itself
                    rejected[job.doc.path] = Self.mark(job.doc, job.side)
                    fileLock.lock(); writeJSON(rejectedURL, rejected); fileLock.unlock()
                    progress(["done": done, "total": total, "rejected": job.doc.path])
                case .later:
                    more = true
                }
            }
        }
        if total > 0 { progress(["done": done, "total": total, "finished": !more]) }

        // the documents themselves come down from iCloud in the background (iOS does that even while Findly is
        // closed); pages opened before theirs has arrived fetch it there and then
        for (path, e) in all where !e.here && Self.isDocument(path) && !askedDownload.contains(path) {
            askedDownload.insert(path)
            try? fm.startDownloadingUbiquitousItem(at: e.url)
        }
        return more
    }

    private func progress(_ d: [String: Any]) {
        guard let cb = onProgress else { return }
        DispatchQueue.main.async { cb(d) }
    }

    /// Reads one document's text file and puts its pages in the search database. → what the page needs to list it.
    private enum Ingest { case ok([String: Any]), unusable, later }
    private func ingest(_ side: URL, doc: Entry, placed: [String: Any]?) -> Ingest {
        guard let data = try? Data(contentsOf: side, options: .mappedIfSafe) else { return .later } // gone again: next time
        guard let sc = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let pages = sc["pages"] as? [String], !pages.isEmpty else { return .unusable }
        let name = (doc.path as NSString).lastPathComponent
        let scSize = (sc["size"] as? NSNumber)?.intValue ?? 0
        if doc.size > 0 && scSize > 0 && doc.size != scSize { return .unusable } // text of a different version
        if let n = sc["name"] as? String, n != name { return .unusable }
        let id = UUID().uuidString.lowercased()
        guard putPages(id, pages) else { return .later }
        let lens = pages.map { $0.utf16.count }
        let opening = pages.prefix(4).first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.map { String($0.prefix(1200)) } ?? ""
        var item: [String: Any] = [
            "id": id, "path": doc.path, "name": name, "size": doc.size > 0 ? doc.size : scSize,
            "meta": Self.clean(sc["meta"]) ?? [String: Any](), "lens": lens, "opening": opening,
        ]
        if let p = placed {
            if let o = p["order"] { item["order"] = o }
            if let f = p["folderId"], !(f is NSNull) { item["folderId"] = f }
            if let e = p["enabled"] { item["enabled"] = e }
        }
        return .ok(item)
    }

    /// JSON without nulls (they don't cross to the page cleanly; a missing value means the same there).
    static func clean(_ v: Any?) -> Any? {
        guard let v = v, !(v is NSNull) else { return nil }
        if let d = v as? [String: Any] { return d.compactMapValues { clean($0) } }
        if let a = v as? [Any] { return a.compactMap { clean($0) } }
        return v
    }

    // MARK: the search database (the same file ISIndexPlugin uses; WAL lets both connections work)

    private var db: OpaquePointer?
    private var fts = false
    private let TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private func openDB() -> Bool {
        if db != nil { return true }
        let url = support.appendingPathComponent("findly-text.sqlite")
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(db); db = nil; return false
        }
        sqlite3_busy_timeout(db, 15000)
        sqlite3_exec(db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;", nil, nil, nil)
        sqlite3_exec(db, "CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY, doc TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL);", nil, nil, nil)
        sqlite3_exec(db, "CREATE UNIQUE INDEX IF NOT EXISTS pages_doc ON pages(doc, n);", nil, nil, nil)
        fts = sqlite3_exec(db, "CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content='pages', content_rowid='id', tokenize='trigram');", nil, nil, nil) == SQLITE_OK
        return true
    }

    private func putPages(_ id: String, _ pages: [String]) -> Bool {
        guard openDB() else { return false }
        guard sqlite3_exec(db, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK else { return false }
        var ins: OpaquePointer?, fins: OpaquePointer?
        sqlite3_prepare_v2(db, "INSERT INTO pages(doc, n, text) VALUES(?, ?, ?)", -1, &ins, nil)
        if fts { sqlite3_prepare_v2(db, "INSERT INTO fts(rowid, text) VALUES(?, ?)", -1, &fins, nil) }
        var ok = ins != nil
        for (i, t) in pages.enumerated() where ok {
            sqlite3_bind_text(ins, 1, id, -1, TRANSIENT)
            sqlite3_bind_int(ins, 2, Int32(i))
            sqlite3_bind_text(ins, 3, t, -1, TRANSIENT)
            ok = sqlite3_step(ins) == SQLITE_DONE
            sqlite3_reset(ins)
            if ok, let f = fins {
                sqlite3_bind_int64(f, 1, sqlite3_last_insert_rowid(db))
                sqlite3_bind_text(f, 2, t, -1, TRANSIENT)
                ok = sqlite3_step(f) == SQLITE_DONE
                sqlite3_reset(f)
            }
        }
        sqlite3_finalize(ins)
        if let f = fins { sqlite3_finalize(f) }
        sqlite3_exec(db, ok ? "COMMIT" : "ROLLBACK", nil, nil, nil)
        return ok
    }

    // MARK: in the background

    /// Called from application(_:didFinishLaunchingWithOptions:) (iOS requires it there).
    func registerBackground() {
        for id in [Self.refreshTask, Self.processingTask] {
            BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { [weak self] task in self?.handle(task) }
        }
        // a launch (in the background or not) with iCloud on: start listening and catch up
        work.async {
            guard UserDefaults.standard.bool(forKey: Self.cloudKey) else { return }
            self.findContainer()
            DispatchQueue.main.async { if self.cloudOn { self.watch(); self.kick() } }
        }
    }

    /// Asks iOS to wake Findly to sync (when the switch is on); called on going to the background.
    func schedule() {
        guard backgroundOn, UserDefaults.standard.bool(forKey: Self.cloudKey) else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTask)
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTask)
            return
        }
        let r = BGAppRefreshTaskRequest(identifier: Self.refreshTask)
        r.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(r)
        let p = BGProcessingTaskRequest(identifier: Self.processingTask)
        p.requiresNetworkConnectivity = true
        p.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(p)
    }

    private func handle(_ task: BGTask) {
        schedule() // and the next one
        guard backgroundOn, UserDefaults.standard.bool(forKey: Self.cloudKey) else { task.setTaskCompleted(success: true); return }
        task.expirationHandler = { [weak self] in self?.cancelled = true }
        let long = task is BGProcessingTask
        work.async {
            self.cancelled = false
            self.findContainer()
            DispatchQueue.main.sync { self.watch() }
            // a few rounds: text files on their way down from iCloud are taken in as they arrive
            let until = Date().addingTimeInterval(long ? 8 * 60 : 25)
            while !self.cancelled && Date() < until {
                if !self.runOnce() { break }
                Thread.sleep(forTimeInterval: long ? 5 : 3)
            }
            task.setTaskCompleted(success: !self.cancelled)
        }
    }
}
