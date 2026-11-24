import Foundation
import Capacitor
import CoreSpotlight
import UniformTypeIdentifiers
import AppIntents

/// Spotlight and Shortcuts/Siri: documents show up in Spotlight (tap one to open it here), and
/// "Search Findly" runs a search from Shortcuts, Siri or the Action button.
@objc(ISLinkPlugin)
public class ISLinkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ISLinkPlugin"
    public let jsName = "ISLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "index", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise),
    ]
    static var pending: [String: Any]?
    static weak var current: ISLinkPlugin?

    override public func load() {
        ISLinkPlugin.current = self
        NotificationCenter.default.addObserver(self, selector: #selector(activity(_:)), name: .capacitorContinueActivity, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(universal(_:)), name: .capacitorOpenUniversalLink, object: nil)
    }

    /// Something asked the app to open: a Spotlight result or a Shortcut.
    static func deliver(_ what: [String: Any]) {
        DispatchQueue.main.async {
            pending = what
            current?.notifyListeners("open", data: what)
        }
    }

    @objc private func activity(_ note: Notification) {
        guard let a = note.object as? NSUserActivity else { return }
        if a.activityType == CSSearchableItemActionType, let id = a.userInfo?[CSSearchableItemActivityIdentifier] as? String {
            ISLinkPlugin.deliver(["doc": id])
        } else if a.activityType == CSQueryContinuationActionType, let q = a.userInfo?[CSSearchQueryString] as? String {
            ISLinkPlugin.deliver(["q": q])
        }
    }

    /// A link to a search (https://instant-search-virid.vercel.app/#find?…) tapped somewhere: open it here.
    @objc private func universal(_ note: Notification) {
        guard let info = note.object as? [String: Any], let url = info["url"] as? URL else { return }
        ISLinkPlugin.deliver(["url": url.absoluteString])
    }

    /// Replaces what Spotlight knows with the library as it is now: [{ id, title, text, pages }].
    @objc func index(_ call: CAPPluginCall) {
        let docs = call.getArray("docs", JSObject.self) ?? []
        let items: [CSSearchableItem] = docs.compactMap { d in
            guard let id = d["id"] as? String, let title = d["title"] as? String else { return nil }
            let attrs = CSSearchableItemAttributeSet(contentType: UTType.pdf)
            attrs.title = title
            attrs.contentDescription = (d["text"] as? String).map { String($0.prefix(300)) }
            attrs.textContent = d["text"] as? String
            if let pages = d["pages"] as? Int { attrs.pageCount = NSNumber(value: pages) }
            return CSSearchableItem(uniqueIdentifier: id, domainIdentifier: "library", attributeSet: attrs)
        }
        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: ["library"]) { _ in
            index.indexSearchableItems(items) { err in
                if let err { call.reject(err.localizedDescription) } else { call.resolve(["count": items.count]) }
            }
        }
    }

    @objc func takePending(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let p = ISLinkPlugin.pending
            ISLinkPlugin.pending = nil
            call.resolve(p ?? [:])
        }
    }
}

// MARK: - Shortcuts and Siri

struct SearchDocumentsIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Documents"
    static var description = IntentDescription("Searches your Findly library and shows the pages with hits.")
    static var openAppWhenRun = true

    @Parameter(title: "Search for", requestValueDialog: "What should I look for?")
    var query: String

    static var parameterSummary: some ParameterSummary { Summary("Search documents for \(\.$query)") }

    @MainActor
    func perform() async throws -> some IntentResult {
        ISLinkPlugin.deliver(["q": query])
        return .result()
    }
}

struct InstantSearchShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SearchDocumentsIntent(),
            phrases: ["Search \(.applicationName)", "Search my documents in \(.applicationName)", "Look something up in \(.applicationName)"],
            shortTitle: "Search Documents",
            systemImageName: "doc.text.magnifyingglass"
        )
    }
}
