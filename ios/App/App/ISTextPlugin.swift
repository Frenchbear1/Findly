import Foundation
import Capacitor
import Vision
import UIKit

/// Live Text for scanned pages: the web side draws a page to a picture and this reads the text in it,
/// on the device (Apple's Vision text recognition), so scanned PDFs become searchable.
@objc(ISTextPlugin)
public class ISTextPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ISTextPlugin"
    public let jsName = "ISText"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise),
    ]
    private let queue = DispatchQueue(label: "instantsearch.text", qos: .userInitiated)

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"), let data = Data(base64Encoded: b64), let image = UIImage(data: data)?.cgImage else {
            return call.reject("no picture")
        }
        queue.async {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            do {
                try handler.perform([request])
                let obs = (request.results ?? []).sorted { a, b in
                    // reading order: top to bottom, then left to right (Vision's y grows upwards)
                    abs(a.boundingBox.midY - b.boundingBox.midY) > 0.01 ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX
                }
                var lines: [[String: Any]] = []
                for o in obs {
                    guard let best = o.topCandidates(1).first else { continue }
                    let r = o.boundingBox
                    lines.append(["text": best.string, "x": r.minX, "y": 1 - r.maxY, "w": r.width, "h": r.height])
                }
                call.resolve(["text": lines.map { $0["text"] as! String }.joined(separator: "\n"), "lines": lines])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}
