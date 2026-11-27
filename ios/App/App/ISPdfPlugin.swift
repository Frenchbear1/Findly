import Foundation
import Capacitor
import PDFKit
import UIKit
import Vision

/// Draws PDF pages with Apple's own PDF engine, in the app rather than in the web page: far lighter on
/// memory than drawing them in the page with pdf.js (which on long, picture-heavy manuals ran the page out of
/// memory, and iOS then reloaded it). The web side asks for a page, or just a part of one, at a given size;
/// this draws it to a JPEG in a cache folder and answers with the file's path, which the page shows as an
/// image. Documents are the library's own files, opened straight from disk (PDFKit reads them as needed).
@objc(ISPdfPlugin)
public class ISPdfPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ISPdfPlugin"
    public let jsName = "ISPdf"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "render", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ocr", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "instantsearch.pdf", qos: .userInitiated) // one at a time: a PDFDocument isn't safe to draw from two threads
    private let lock = NSLock()
    private var docs: [String: PDFDocument] = [:] // a few open documents, most recently used last
    private var order: [String] = []
    private var made: [URL] = [] // the images drawn, oldest first (old ones are deleted)
    private lazy var cache: URL = {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pages", isDirectory: true)
        try? FileManager.default.removeItem(at: dir) // last run's pages
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    public override func load() {
        // let go of open documents when iOS asks for memory back
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
            guard let self = self else { return }
            self.lock.lock(); self.docs.removeAll(); self.order.removeAll(); self.lock.unlock()
        }
    }

    private func document(_ url: URL) -> PDFDocument? {
        let key = url.path
        lock.lock(); defer { lock.unlock() }
        if let d = docs[key] {
            order.removeAll { $0 == key }; order.append(key)
            return d
        }
        guard let d = PDFDocument(url: url) else { return nil }
        docs[key] = d
        order.append(key)
        while order.count > 3 { docs.removeValue(forKey: order.removeFirst()) }
        return d
    }

    /// { file (absolute file URL or path), page (0-based), width (the whole page's width in pixels),
    ///   x0, x1, y0, y1 (the part to draw, as fractions of the page; default all), quality (0–1) }
    /// → { path (the image file, absolute), width, height (its pixels) }
    @objc func render(_ call: CAPPluginCall) {
        guard let file = call.getString("file") else { return call.reject("no file") }
        let url = file.hasPrefix("file:") ? (URL(string: file) ?? URL(fileURLWithPath: file)) : URL(fileURLWithPath: file)
        let n = call.getInt("page") ?? 0
        let fullW = max(1, call.getDouble("width") ?? 1000)
        let x0 = call.getDouble("x0") ?? 0, x1 = call.getDouble("x1") ?? 1
        let y0 = call.getDouble("y0") ?? 0, y1 = call.getDouble("y1") ?? 1
        let quality = CGFloat(call.getDouble("quality") ?? 0.82)
        queue.async {
            autoreleasepool {
                guard let doc = self.document(url), let page = doc.page(at: n), let cg = page.pageRef else {
                    return call.reject("can't open the page")
                }
                // the page as pdf.js lays it out: its crop box, turned by its rotation
                let box = cg.getBoxRect(.cropBox)
                let rot = ((Int(cg.rotationAngle) % 360) + 360) % 360
                let turned = rot == 90 || rot == 270
                let pw = turned ? box.height : box.width, ph = turned ? box.width : box.height
                let s = CGFloat(fullW) / pw // pixels per PDF point
                let W = pw * s, H = ph * s
                let rx = floor(CGFloat(x0) * W), ry = floor(CGFloat(y0) * H)
                let rw = max(1, ceil(CGFloat(x1) * W) - rx), rh = max(1, ceil(CGFloat(y1) * H) - ry)
                // never more than about 12 million pixels in one image
                if rw * rh > 12_000_000 { return call.reject("too big") }
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                format.opaque = true
                let image = UIGraphicsImageRenderer(size: CGSize(width: rw, height: rh), format: format).image { ctx in
                    let c = ctx.cgContext
                    UIColor.white.setFill()
                    c.fill(CGRect(x: 0, y: 0, width: rw, height: rh))
                    c.interpolationQuality = .high
                    c.setRenderingIntent(.defaultIntent)
                    // the part asked for, then from the image's top-left corner to PDF's bottom-left
                    c.translateBy(x: -rx, y: -ry)
                    c.translateBy(x: 0, y: H)
                    c.scaleBy(x: 1, y: -1)
                    let bx = box.minX, by = box.minY, bw = box.width, bh = box.height
                    let t: CGAffineTransform
                    switch rot {
                    case 90: t = CGAffineTransform(a: 0, b: -s, c: s, d: 0, tx: -by * s, ty: (bx + bw) * s)
                    case 180: t = CGAffineTransform(a: -s, b: 0, c: 0, d: -s, tx: (bx + bw) * s, ty: (by + bh) * s)
                    case 270: t = CGAffineTransform(a: 0, b: s, c: -s, d: 0, tx: (by + bh) * s, ty: -bx * s)
                    default: t = CGAffineTransform(a: s, b: 0, c: 0, d: s, tx: -bx * s, ty: -by * s)
                    }
                    c.concatenate(t)
                    c.clip(to: box)
                    c.drawPDFPage(cg)
                }
                guard let data = image.jpegData(compressionQuality: quality) else { return call.reject("couldn't make the image") }
                let out = self.cache.appendingPathComponent(UUID().uuidString + ".jpg")
                do { try data.write(to: out) } catch { return call.reject(error.localizedDescription) }
                self.lock.lock()
                self.made.append(out)
                // keep the last few hundred (what's on screen and near it); older ones are long gone from view
                var old: [URL] = []
                while self.made.count > 400 { old.append(self.made.removeFirst()) }
                self.lock.unlock()
                for u in old { try? FileManager.default.removeItem(at: u) }
                call.resolve(["path": out.path, "width": Int(rw), "height": Int(rh)])
            }
        }
    }

    /// { paths: [image paths] } — images no longer shown.
    @objc func forget(_ call: CAPPluginCall) {
        let paths = call.getArray("paths", String.self) ?? []
        queue.async {
            let gone = Set(paths)
            self.lock.lock(); self.made.removeAll { gone.contains($0.path) }; self.lock.unlock()
            for p in paths { try? FileManager.default.removeItem(atPath: p) }
            call.resolve()
        }
    }

    /// Live Text for one page of a library PDF: { file, page (0-based) } → { text }. The page is drawn and read
    /// here, so a scanned manual of any length never passes through the web page.
    @objc func ocr(_ call: CAPPluginCall) {
        guard let file = call.getString("file") else { return call.reject("no file") }
        let url = file.hasPrefix("file:") ? (URL(string: file) ?? URL(fileURLWithPath: file)) : URL(fileURLWithPath: file)
        let n = call.getInt("page") ?? 0
        queue.async {
            autoreleasepool {
                guard let doc = self.document(url), let page = doc.page(at: n) else { return call.reject("can't open the page") }
                let b = page.bounds(for: .cropBox)
                let k = min(2.5, 2200 / max(b.width, b.height, 1))
                guard let cg = page.thumbnail(of: CGSize(width: b.width * k, height: b.height * k), for: .cropBox).cgImage else { return call.reject("can't draw the page") }
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                do {
                    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
                    let obs = (request.results ?? []).sorted { a, b in
                        abs(a.boundingBox.midY - b.boundingBox.midY) > 0.01 ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX
                    }
                    call.resolve(["text": obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }
}

