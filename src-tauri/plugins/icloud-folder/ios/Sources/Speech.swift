// The Reading Room on iPhone and iPad: read an article aloud with the system voices.
// Keeps playing with the screen locked (background audio) and shows Lock Screen / AirPods controls.

import AVFoundation
import Foundation
import MediaPlayer
import Tauri

struct SpeakArgs: Decodable {
  let text: String
  let title: String
  let source: String?
  let rate: Float?
  let offset: Int?
}

struct SpeechControlArgs: Decodable {
  let action: String
  let value: Float?
}

class ArticleSpeaker: NSObject, AVSpeechSynthesizerDelegate {
  let synth = AVSpeechSynthesizer()
  var text: NSString = ""
  var base = 0          // where the current utterance starts in `text`
  var position = 0      // characters read so far
  var state = "idle"    // idle, playing, paused, done
  var rate: Float = 1.0
  var title = ""
  var source = ""
  var commandsReady = false

  override init() {
    super.init()
    synth.delegate = self
  }

  static func bestVoice() -> AVSpeechSynthesisVoice? {
    let lang = AVSpeechSynthesisVoice.currentLanguageCode()
    let prefix = String(lang.prefix(2))
    let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix(prefix) }
    // Premium, then enhanced, then default; prefer the exact region.
    return voices.sorted {
      if $0.quality.rawValue != $1.quality.rawValue { return $0.quality.rawValue > $1.quality.rawValue }
      return ($0.language == lang ? 1 : 0) > ($1.language == lang ? 1 : 0)
    }.first ?? AVSpeechSynthesisVoice(language: lang)
  }

  func start(at offset: Int) {
    synth.stopSpeaking(at: .immediate)
    let len = text.length
    base = max(0, min(offset, len))
    // Start at a word boundary
    while base > 0 && base < len {
      let c = text.character(at: base - 1)
      if c == 32 || c == 10 { break }
      base -= 1
    }
    position = base
    guard base < len else {
      state = "done"
      return
    }
    let u = AVSpeechUtterance(string: text.substring(from: base))
    u.voice = ArticleSpeaker.bestVoice()
    u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * rate)
    u.prefersAssistiveTechnologySettings = false
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
    try? AVAudioSession.sharedInstance().setActive(true)
    state = "playing"
    synth.speak(u)
    setupRemote()
    updateNowPlaying()
  }

  func pause() {
    if synth.isSpeaking { synth.pauseSpeaking(at: .word) }
    state = "paused"
    updateNowPlaying()
  }

  func resume() {
    if synth.isPaused { synth.continueSpeaking() } else { start(at: position) }
    state = "playing"
    updateNowPlaying()
  }

  func stop() {
    synth.stopSpeaking(at: .immediate)
    state = "idle"
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  /// About 15 characters a second at normal speed.
  func skip(seconds: Float) {
    let chars = Int(seconds * 15 * rate)
    start(at: position + chars)
  }

  func setupRemote() {
    if commandsReady { return }
    commandsReady = true
    let cc = MPRemoteCommandCenter.shared()
    cc.playCommand.addTarget { [weak self] _ in self?.resume(); return .success }
    cc.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
    cc.togglePlayPauseCommand.addTarget { [weak self] _ in
      guard let s = self else { return .commandFailed }
      if s.state == "playing" { s.pause() } else { s.resume() }
      return .success
    }
    cc.skipForwardCommand.preferredIntervals = [30]
    cc.skipForwardCommand.addTarget { [weak self] _ in self?.skip(seconds: 30); return .success }
    cc.skipBackwardCommand.preferredIntervals = [15]
    cc.skipBackwardCommand.addTarget { [weak self] _ in self?.skip(seconds: -15); return .success }
  }

  func updateNowPlaying() {
    let total = Double(text.length) / (15.0 * Double(rate))
    let done = Double(position) / (15.0 * Double(rate))
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyArtist: source,
      MPMediaItemPropertyAlbumTitle: "The Reading Room",
      MPMediaItemPropertyPlaybackDuration: total,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: done,
      MPNowPlayingInfoPropertyPlaybackRate: state == "playing" ? 1.0 : 0.0,
    ]
  }

  func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString r: NSRange, utterance: AVSpeechUtterance) {
    position = base + r.location
  }

  func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    if state == "playing" {
      state = "done"
      position = text.length
      updateNowPlaying()
    }
  }
}

extension ICloudFolderPlugin {
  @objc public func speak(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpeakArgs.self)
    DispatchQueue.main.async {
      let sp = self.speaker
      sp.text = args.text as NSString
      sp.title = args.title
      sp.source = args.source ?? ""
      sp.rate = max(0.5, min(2.5, args.rate ?? 1.0))
      sp.start(at: args.offset ?? 0)
      invoke.resolve(self.speechState())
    }
  }

  @objc public func speechControl(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SpeechControlArgs.self)
    DispatchQueue.main.async {
      let sp = self.speaker
      switch args.action {
      case "pause": sp.pause()
      case "resume": sp.resume()
      case "stop": sp.stop()
      case "skip": sp.skip(seconds: args.value ?? 30)
      case "rate":
        sp.rate = max(0.5, min(2.5, args.value ?? 1.0))
        if sp.state == "playing" { sp.start(at: sp.position) }
      default: break
      }
      invoke.resolve(self.speechState())
    }
  }

  @objc public func speechStatus(_ invoke: Invoke) throws {
    DispatchQueue.main.async { invoke.resolve(self.speechState()) }
  }

  func speechState() -> JsonObject {
    let sp = speaker
    return ["state": sp.state, "position": sp.position, "length": sp.text.length, "rate": sp.rate]
  }
}
