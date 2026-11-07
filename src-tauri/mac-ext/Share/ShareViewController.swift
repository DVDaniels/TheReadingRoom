// "Reading Room" in the Mac's Share menu: saves the page to Read later and closes itself.
import AppKit
import UniformTypeIdentifiers

final class ShareViewController: NSViewController {
    private let label = NSTextField(labelWithString: "Saving…")

    override func loadView() {
        let v = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 90))
        label.font = .systemFont(ofSize: 14, weight: .semibold)
        label.alignment = .center
        label.maximumNumberOfLines = 3
        label.lineBreakMode = .byWordWrapping
        label.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: v.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: v.centerYAnchor),
            label.widthAnchor.constraint(equalToConstant: 270),
        ])
        view = v
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        Task { await save() }
    }

    private func save() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var found: URL?
        var title = items.first?.attributedContentText?.string ?? items.first?.attributedTitle?.string ?? ""
        for item in items {
            for p in item.attachments ?? [] where found == nil {
                if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let u = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, u.scheme?.hasPrefix("http") == true {
                    found = u
                } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let s = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    let det = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
                    if let m = det?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), let u = m.url, u.scheme?.hasPrefix("http") == true {
                        found = u
                        if title.isEmpty { title = s.replacingOccurrences(of: u.absoluteString, with: "").trimmingCharacters(in: .whitespacesAndNewlines) }
                    }
                }
            }
        }
        let ok = found.map { SharedStore.addToInbox(url: $0.absoluteString, title: title) } ?? false
        label.stringValue = found == nil ? "There’s no web page to save here." : ok ? "Saved to Read later ✓" : "Couldn’t save this page. Try again."
        try? await Task.sleep(nanoseconds: ok ? 1_000_000_000 : 2_000_000_000)
        extensionContext?.completeRequest(returningItems: nil)
    }
}
