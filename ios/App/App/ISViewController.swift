import UIKit
import WebKit
import Capacitor

/// Hosts the web app and registers Instant Search's own native plugins.
class ISViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ISFilesPlugin())
        bridge?.registerPluginInstance(ISTextPlugin())
        bridge?.registerPluginInstance(ISLinkPlugin())
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear
        // the pages pinch-zoom themselves; the page itself shouldn't bounce sideways
        webView?.scrollView.alwaysBounceHorizontal = false
        webView?.scrollView.showsVerticalScrollIndicator = false // the app draws its own scrubber (js/scrub.js)
    }
}
