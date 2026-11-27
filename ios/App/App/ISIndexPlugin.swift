import Foundation
import Capacitor
import SQLite3

/// The library's page text, kept in a database on the iPhone instead of in the app's memory, with a full-text
/// index (SQLite FTS5, trigram: it finds any run of three or more letters, so "port" still finds "airport").
///
/// Searching works in two steps. The index names the pages that can possibly match (every word of three or
/// more letters in the query has to be on them); then each of those pages is matched exactly with the same
/// rules the app uses everywhere else (the web page compiles the query and sends the patterns), so results
/// are identical to before. Short words the index can't narrow ("a", "at") fall back to reading every page,
/// one at a time from disk. Nothing ever needs all the text in memory, however big the library gets.
///
/// Results go back as a small summary plus a binary file of hit positions (written in the cache folder and
/// read by the page directly), so even millions of hits don't pass through the bridge as JSON.
@objc(ISIndexPlugin)
public class ISIndexPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ISIndexPlugin"
    public let jsName = "ISIndex"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "put", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "search", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    private let writeQ = DispatchQueue(label: "findly.index.write")
    private let readQ = DispatchQueue(label: "findly.index.read")
    private var wdb: OpaquePointer? // writes (adding, removing documents)
    private var rdb: OpaquePointer? // reads (searching, page text); WAL lets both work at once
    private var fts = false // whether this iPhone's SQLite has the trigram index (iOS 15+); without it every page is read
    private var latest: Int = 0
    private let latestLock = NSLock()
    private var opened = false
    private let openLock = NSLock()

    private lazy var dbURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var url = dir.appendingPathComponent("findly-text.sqlite")
        var v = URLResourceValues(); v.isExcludedFromBackup = true // rebuilt from the documents if ever lost
        try? url.setResourceValues(v)
        return url
    }()
    private lazy var outDir: URL = {
        let d = FileManager.default.temporaryDirectory.appendingPathComponent("search", isDirectory: true)
        try? FileManager.default.removeItem(at: d)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private let TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private func ensureOpen() throws {
        openLock.lock(); defer { openLock.unlock() }
        if opened { return }
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(dbURL.path, &wdb, flags, nil) == SQLITE_OK else { throw err(wdb) }
        sqlite3_busy_timeout(wdb, 15000) // iCloud sync (ISCloudSync) writes to the same database: take turns
        exec(wdb, "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        exec(wdb, "CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY, doc TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL);")
        exec(wdb, "CREATE UNIQUE INDEX IF NOT EXISTS pages_doc ON pages(doc, n);")
        fts = sqlite3_exec(wdb, "CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, content='pages', content_rowid='id', tokenize='trigram');", nil, nil, nil) == SQLITE_OK
        guard sqlite3_open_v2(dbURL.path, &rdb, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw err(rdb) }
        sqlite3_busy_timeout(rdb, 5000)
        exec(rdb, "PRAGMA cache_size=-8000;") // about 8 MB of page cache for searching, not more
        opened = true
    }

    private func err(_ db: OpaquePointer?) -> NSError {
        NSError(domain: "ISIndex", code: 1, userInfo: [NSLocalizedDescriptionKey: db.map { String(cString: sqlite3_errmsg($0)) } ?? "can't open the text database"])
    }
    @discardableResult private func exec(_ db: OpaquePointer?, _ sql: String) -> Bool { sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK }
    private func prepare(_ db: OpaquePointer?, _ sql: String) -> OpaquePointer? {
        var st: OpaquePointer?
        return sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK ? st : nil
    }
    private func text(_ st: OpaquePointer?, _ col: Int32) -> String {
        guard let c = sqlite3_column_text(st, col) else { return "" }
        return String(cString: c)
    }

    // ---------- the library ----------

    /// → { fts: Bool, docs: { id: [characters on each page] } } — what's stored, for page counts.
    @objc func info(_ call: CAPPluginCall) {
        readQ.async {
            do { try self.ensureOpen() } catch { return call.reject(error.localizedDescription) }
            var docs: [String: [Int]] = [:]
            if let st = self.prepare(self.rdb, "SELECT doc, n, length(text) FROM pages ORDER BY doc, n") {
                while sqlite3_step(st) == SQLITE_ROW {
                    let d = self.text(st, 0)
                    docs[d, default: []].append(Int(sqlite3_column_int(st, 2)))
                }
                sqlite3_finalize(st)
            }
            call.resolve(["fts": self.fts, "docs": docs])
        }
    }

    /// { id, pages: [text], append: Bool } — a document's pages (replacing what was stored, unless append, which
    /// adds pages after the ones there: big documents come in parts).
    @objc func put(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("no id") }
        let pages = call.getArray("pages", String.self) ?? []
        let append = call.getBool("append") ?? false
        writeQ.async {
            do { try self.ensureOpen() } catch { return call.reject(error.localizedDescription) }
            let db = self.wdb
            self.exec(db, "BEGIN IMMEDIATE")
            var start = 0
            if append {
                if let st = self.prepare(db, "SELECT COALESCE(MAX(n) + 1, 0) FROM pages WHERE doc = ?") {
                    sqlite3_bind_text(st, 1, id, -1, self.TRANSIENT)
                    if sqlite3_step(st) == SQLITE_ROW { start = Int(sqlite3_column_int(st, 0)) }
                    sqlite3_finalize(st)
                }
            } else {
                self.removeRows(id)
            }
            let ins = self.prepare(db, "INSERT INTO pages(doc, n, text) VALUES(?, ?, ?)")
            let fins = self.fts ? self.prepare(db, "INSERT INTO fts(rowid, text) VALUES(?, ?)") : nil
            var ok = ins != nil
            for (i, t) in pages.enumerated() where ok {
                sqlite3_bind_text(ins, 1, id, -1, self.TRANSIENT)
                sqlite3_bind_int(ins, 2, Int32(start + i))
                sqlite3_bind_text(ins, 3, t, -1, self.TRANSIENT)
                ok = sqlite3_step(ins) == SQLITE_DONE
                sqlite3_reset(ins)
                if ok, let f = fins {
                    sqlite3_bind_int64(f, 1, sqlite3_last_insert_rowid(db))
                    sqlite3_bind_text(f, 2, t, -1, self.TRANSIENT)
                    ok = sqlite3_step(f) == SQLITE_DONE
                    sqlite3_reset(f)
                }
            }
            sqlite3_finalize(ins)
            if let f = fins { sqlite3_finalize(f) }
            if ok {
                self.exec(db, "COMMIT")
                call.resolve(["pages": start + pages.count])
            } else {
                let msg = String(cString: sqlite3_errmsg(db))
                self.exec(db, "ROLLBACK")
                call.reject(msg)
            }
        }
    }

    private func removeRows(_ id: String) {
        if fts, let st = prepare(wdb, "INSERT INTO fts(fts, rowid, text) SELECT 'delete', id, text FROM pages WHERE doc = ?") {
            sqlite3_bind_text(st, 1, id, -1, TRANSIENT); sqlite3_step(st); sqlite3_finalize(st)
        }
        if let st = prepare(wdb, "DELETE FROM pages WHERE doc = ?") {
            sqlite3_bind_text(st, 1, id, -1, TRANSIENT); sqlite3_step(st); sqlite3_finalize(st)
        }
    }

    /// { ids: [id] }
    @objc func remove(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        writeQ.async {
            do { try self.ensureOpen() } catch { return call.reject(error.localizedDescription) }
            self.exec(self.wdb, "BEGIN IMMEDIATE")
            for id in ids { self.removeRows(id) }
            self.exec(self.wdb, "COMMIT")
            call.resolve()
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        writeQ.async {
            do { try self.ensureOpen() } catch { return call.reject(error.localizedDescription) }
            self.exec(self.wdb, "BEGIN IMMEDIATE")
            if self.fts { self.exec(self.wdb, "INSERT INTO fts(fts) VALUES('delete-all')") }
            self.exec(self.wdb, "DELETE FROM pages")
            self.exec(self.wdb, "COMMIT")
            call.resolve()
        }
    }

    /// { id, from, to } → { pages: [text] } — pages from..<to of a document.
    @objc func pages(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { return call.reject("no id") }
        let from = call.getInt("from") ?? 0, to = call.getInt("to") ?? Int(Int32.max)
        readQ.async {
            do { try self.ensureOpen() } catch { return call.reject(error.localizedDescription) }
            var out: [String] = []
            if let st = self.prepare(self.rdb, "SELECT text FROM pages WHERE doc = ? AND n >= ? AND n < ? ORDER BY n") {
                sqlite3_bind_text(st, 1, id, -1, self.TRANSIENT)
                sqlite3_bind_int(st, 2, Int32(from))
                sqlite3_bind_int(st, 3, Int32(min(to, Int(Int32.max))))
                while sqlite3_step(st) == SQLITE_ROW { out.append(self.text(st, 0)) }
                sqlite3_finalize(st)
            }
            call.resolve(["pages": out])
        }
    }

    /// → { docs: { id: the start of its first page with text } } — short descriptions of every document.
    @objc func openings(_ call: CAPPluginCall) {
        readQ.async {
            do { try self.ensureOpen() } catch { return call.reject(error.localizedDescription) }
            var out: [String: String] = [:]
            if let st = self.prepare(self.rdb, "SELECT doc, substr(text, 1, 1200) FROM pages WHERE n < 4 ORDER BY doc, n") {
                while sqlite3_step(st) == SQLITE_ROW {
                    let d = self.text(st, 0)
                    if out[d] != nil { continue }
                    let t = self.text(st, 1)
                    if !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { out[d] = t }
                }
                sqlite3_finalize(st)
            }
            call.resolve(["docs": out])
        }
    }

    // ---------- searching ----------

    private struct Term { let re: NSRegularExpression; let neg: Bool; let color: Int32; let lits: [String] }
    private indirect enum Node { case term(Int), and([Node]), or([Node]), not(Node) }

    private func node(_ o: Any?) -> Node? {
        guard let d = o as? [String: Any], let type = d["type"] as? String else { return nil }
        switch type {
        case "term": return (d["idx"] as? Int).map { .term($0) }
        case "and": return .and(((d["kids"] as? [Any]) ?? []).compactMap(node))
        case "or": return .or(((d["kids"] as? [Any]) ?? []).compactMap(node))
        case "not": return node(d["kid"]).map { .not($0) }
        default: return nil
        }
    }
    private func eval(_ n: Node, _ present: [Bool]) -> Bool {
        switch n {
        case .term(let i): return i < present.count && present[i]
        case .and(let k): return k.allSatisfy { eval($0, present) }
        case .or(let k): return k.contains { eval($0, present) }
        case .not(let k): return !eval(k, present)
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        latestLock.lock(); latest = call.getInt("qid") ?? (latest + 1); latestLock.unlock()
        call.resolve()
    }
    private func current(_ qid: Int) -> Bool { latestLock.lock(); defer { latestLock.unlock() }; return latest == qid }

    /// { qid, ids: [doc ids, in result order], mode, dist, matchCase, ast?, terms: [{ src, neg, color, lits }] }
    /// → { cancelled } | { path, docs: [{ id, pages, hits }] } with the file holding, for each document in turn,
    /// Int32s: its hit pages, each page's hit count, then (start, end, colour) for every hit.
    @objc func search(_ call: CAPPluginCall) {
        let qid = call.getInt("qid") ?? 0
        latestLock.lock(); latest = qid; latestLock.unlock()
        let ids = call.getArray("ids", String.self) ?? []
        let mode = call.getString("mode") ?? "all"
        let dist = max(1, call.getInt("dist") ?? 8)
        let matchCase = call.getBool("matchCase") ?? false
        let rawTerms = call.getArray("terms", JSObject.self) ?? []
        let ast = node(call.getObject("ast"))
        var terms: [Term] = []
        for t in rawTerms {
            guard let src = t["src"] as? String,
                  let re = try? NSRegularExpression(pattern: src, options: matchCase ? [] : [.caseInsensitive]) else {
                return call.reject("bad pattern")
            }
            terms.append(Term(re: re, neg: (t["neg"] as? Bool) ?? false, color: Int32((t["color"] as? Int) ?? 0), lits: (t["lits"] as? [String]) ?? []))
        }
        readQ.async {
            do { try self.ensureOpen() } catch { return call.reject(error.localizedDescription) }
            if !self.current(qid) { return call.resolve(["cancelled": true]) }
            let posIdx = terms.indices.filter { !terms[$0].neg }
            let negIdx = terms.indices.filter { terms[$0].neg }

            // 1. the pages that can match, from the index (nil: can't narrow, read them all)
            var cand: Set<Int64>? = nil
            if self.fts {
                var sets: [Int: Set<Int64>?] = [:]
                func termSet(_ i: Int) -> Set<Int64>? {
                    if let s = sets[i] { return s }
                    let lits = terms[i].lits.filter { $0.count >= 3 }
                    var s: Set<Int64>? = nil
                    if !lits.isEmpty {
                        let q = lits.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }.joined(separator: " AND ")
                        if let st = self.prepare(self.rdb, "SELECT rowid FROM fts WHERE fts MATCH ?") {
                            sqlite3_bind_text(st, 1, q, -1, self.TRANSIENT)
                            var got = Set<Int64>()
                            while sqlite3_step(st) == SQLITE_ROW { got.insert(sqlite3_column_int64(st, 0)) }
                            sqlite3_finalize(st)
                            s = got
                        }
                    }
                    sets[i] = s
                    return s
                }
                func inter(_ xs: [Set<Int64>?]) -> Set<Int64>? {
                    var out: Set<Int64>? = nil
                    for x in xs { if let x = x { out = out.map { $0.intersection(x) } ?? x } }
                    return out
                }
                func union(_ xs: [Set<Int64>?]) -> Set<Int64>? {
                    var out = Set<Int64>()
                    for x in xs { guard let x = x else { return nil }; out.formUnion(x) }
                    return out
                }
                func narrow(_ n: Node) -> Set<Int64>? {
                    switch n {
                    case .term(let i): return i < terms.count ? termSet(i) : nil
                    case .and(let k): return inter(k.map(narrow))
                    case .or(let k): return union(k.map(narrow))
                    case .not: return nil
                    }
                }
                if mode == "boolean" { cand = ast.flatMap(narrow) }
                else if mode == "any" || mode == "phrase" { cand = union(posIdx.map(termSet)) }
                else { cand = inter(posIdx.map(termSet)) }
            }
            if !self.current(qid) { return call.resolve(["cancelled": true]) }

            // 2. match those pages exactly, document by document in the order asked
            var out = Data()
            var summary: [[String: Any]] = []
            let all = self.prepare(self.rdb, "SELECT id, n, text FROM pages WHERE doc = ? ORDER BY n")
            let some = self.prepare(self.rdb, "SELECT n, text FROM pages WHERE id = ?")
            let docOf = cand != nil ? self.prepare(self.rdb, "SELECT id, doc, n FROM pages WHERE id = ?") : nil
            defer { sqlite3_finalize(all); sqlite3_finalize(some); sqlite3_finalize(docOf) }

            // candidates grouped by document (row ids are looked up once)
            var byDoc: [String: [(Int64, Int32)]] = [:]
            if let c = cand, let st = docOf {
                for rid in c {
                    sqlite3_bind_int64(st, 1, rid)
                    if sqlite3_step(st) == SQLITE_ROW { byDoc[self.text(st, 1), default: []].append((rid, sqlite3_column_int(st, 2))) }
                    sqlite3_reset(st)
                }
            }

            var checked = 0
            for id in ids {
                var ns: [Int32] = [], counts: [Int32] = [], data: [Int32] = []
                let visit: (Int32, String) -> Void = { n, page in
                    if let r = self.match(page as NSString, terms, posIdx, negIdx, mode, dist, ast) {
                        ns.append(n); counts.append(Int32(r.count))
                        for x in r { data.append(x.0); data.append(x.1); data.append(x.2) }
                    }
                }
                if cand != nil {
                    for (rid, n) in (byDoc[id] ?? []).sorted(by: { $0.1 < $1.1 }) {
                        sqlite3_bind_int64(some, 1, rid)
                        if sqlite3_step(some) == SQLITE_ROW { autoreleasepool { visit(n, self.text(some, 1)) } }
                        sqlite3_reset(some)
                        checked += 1
                        if checked % 64 == 0 && !self.current(qid) { return call.resolve(["cancelled": true]) }
                    }
                } else if let st = all {
                    sqlite3_bind_text(st, 1, id, -1, self.TRANSIENT)
                    while sqlite3_step(st) == SQLITE_ROW {
                        autoreleasepool { visit(sqlite3_column_int(st, 1), self.text(st, 2)) }
                        checked += 1
                        if checked % 64 == 0 && !self.current(qid) { sqlite3_reset(st); return call.resolve(["cancelled": true]) }
                    }
                    sqlite3_reset(st)
                }
                if !ns.isEmpty {
                    for arr in [ns, counts, data] { arr.withUnsafeBufferPointer { out.append(Data(buffer: $0)) } }
                    summary.append(["id": id, "pages": ns.count, "hits": data.count / 3])
                }
            }
            if !self.current(qid) { return call.resolve(["cancelled": true]) }
            let file = self.outDir.appendingPathComponent("q\(qid).bin")
            // older answers are gone by now
            if let old = try? FileManager.default.contentsOfDirectory(at: self.outDir, includingPropertiesForKeys: nil) {
                for u in old where u != file { try? FileManager.default.removeItem(at: u) }
            }
            do { try out.write(to: file) } catch { return call.reject(error.localizedDescription) }
            call.resolve(["path": file.path, "docs": summary, "narrowed": cand != nil])
        }
    }

    private let wordRe = try! NSRegularExpression(pattern: "[\\p{L}\\p{N}_]+")
    private let MAX_PER_TERM = 4000

    private func findAll(_ re: NSRegularExpression, _ s: NSString) -> [(Int32, Int32)] {
        var out: [(Int32, Int32)] = []
        re.enumerateMatches(in: s as String, options: [], range: NSRange(location: 0, length: s.length)) { m, _, stop in
            guard let r = m?.range, r.length > 0 else { return }
            out.append((Int32(r.location), Int32(r.location + r.length)))
            if out.count >= self.MAX_PER_TERM { stop.pointee = true }
        }
        return out
    }

    /// The page's hits as the app's own matcher finds them (see compile in search.js): ranges sorted, overlaps
    /// merged; nil if the page isn't a hit.
    private func match(_ s: NSString, _ terms: [Term], _ posIdx: [Int], _ negIdx: [Int], _ mode: String, _ dist: Int, _ ast: Node?) -> [(Int32, Int32, Int32)]? {
        if s.length == 0 { return nil }
        var hits = [[(Int32, Int32)]?](repeating: nil, count: terms.count)
        func get(_ i: Int) -> [(Int32, Int32)] {
            if let h = hits[i] { return h }
            let h = findAll(terms[i].re, s); hits[i] = h; return h
        }
        if mode == "boolean" {
            guard let ast = ast else { return nil }
            let present = terms.indices.map { !get($0).isEmpty }
            if !eval(ast, present) { return nil }
        } else {
            for i in negIdx where !get(i).isEmpty { return nil }
            if mode == "any" || mode == "phrase" {
                if !posIdx.contains(where: { !get($0).isEmpty }) { return nil }
            } else {
                for i in posIdx where get(i).isEmpty { return nil }
            }
        }
        var ranges: [(Int32, Int32, Int32)] = []
        if mode == "near" && posIdx.count > 1 {
            var starts: [Int32] = []
            wordRe.enumerateMatches(in: s as String, options: [], range: NSRange(location: 0, length: s.length)) { m, _, _ in
                if let r = m?.range { starts.append(Int32(r.location)) }
            }
            func wordAt(_ off: Int32) -> Int {
                var lo = 0, hi = starts.count - 1, ans = 0
                while lo <= hi { let mid = (lo + hi) >> 1; if starts[mid] <= off { ans = mid; lo = mid + 1 } else { hi = mid - 1 } }
                return ans
            }
            func within(_ ws: [Int], _ w: Int) -> Bool {
                var lo = 0, hi = ws.count - 1
                while lo <= hi {
                    let mid = (lo + hi) >> 1, v = ws[mid]
                    if v < w - dist { lo = mid + 1 } else if v > w + dist { hi = mid - 1 } else { return true }
                }
                return false
            }
            let words = posIdx.map { get($0).map { wordAt($0.0) } }
            for (k, ti) in posIdx.enumerated() {
                for (j, r) in get(ti).enumerated() {
                    let w = words[k][j]
                    if words.enumerated().allSatisfy({ $0.offset == k || within($0.element, w) }) { ranges.append((r.0, r.1, terms[ti].color)) }
                }
            }
            if ranges.isEmpty { return nil }
        } else {
            for i in posIdx { for r in get(i) { ranges.append((r.0, r.1, terms[i].color)) } }
            if ranges.isEmpty { return mode == "boolean" ? [] : nil }
        }
        ranges.sort { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 > $1.1 }
        var merged: [(Int32, Int32, Int32)] = []
        var end: Int32 = -1
        for r in ranges where r.0 >= end { merged.append(r); end = r.1 }
        return merged
    }
}
