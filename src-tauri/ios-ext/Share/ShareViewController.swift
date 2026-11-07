// "Reading Room" in the Share menu: saves the page to Read later and closes itself.
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let label = UILabel()
    private let card = UIView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.2)
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        label.text = "Saving…"
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)
        card.addSubview(label)
        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 260),
            label.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            label.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -24),
            label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
        ])
        Task { await save() }
    }

    private func save() async {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        var found: URL?
        var title = items.first?.attributedContentText?.string ?? ""
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
        label.text = found == nil ? "There’s no web page to save here." : ok ? "Saved to Read later ✓\nIt’s there next time you open The Reading Room." : "Couldn’t save this page. Try again."
        try? await Task.sleep(nanoseconds: ok ? 1_200_000_000 : 2_000_000_000)
        extensionContext?.completeRequest(returningItems: nil)
    }
}
