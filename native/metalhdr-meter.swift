// metalhdr-meter —— 从 macOS 读取显示器 EDR 余量，供浏览器端查询。
// 用法：
//   metalhdr-meter --json            打印一次
//   metalhdr-meter --serve [--port 8765]   本地 HTTP 服务（默认）
import AppKit
import Foundation
import Network

let SDR_WHITE_NITS = 100.0
let MIN_PEAK = 80.0
let MAX_PEAK = 4000.0

func screenPayload() -> [String: Any] {
    var list: [[String: Any]] = []
    for s in NSScreen.screens {
        let potential = Double(s.maximumPotentialExtendedDynamicRangeColorComponentValue)
        let current = Double(s.maximumExtendedDynamicRangeColorComponentValue)
        let reference = Double(s.maximumReferenceExtendedDynamicRangeColorComponentValue)
        list.append([
            "name": s.localizedName,
            "potential": potential,
            "current": current,
            "reference": reference,
            "nits": min(max(potential * SDR_WHITE_NITS, MIN_PEAK), MAX_PEAK),
            "hdrCapable": potential > 1.01,
        ])
    }

    // 主屏优先；没有主屏时取余量最大的那块
    let mainName = NSScreen.main?.localizedName
    let chosen = list.first { ($0["name"] as? String) == mainName }
        ?? list.max { ($0["potential"] as? Double ?? 1) < ($1["potential"] as? Double ?? 1) }

    let potential = chosen?["potential"] as? Double ?? 1.0
    let nits = min(max(potential * SDR_WHITE_NITS, MIN_PEAK), MAX_PEAK)

    return [
        "ok": true,
        "peakNits": nits,
        "potential": potential,
        "screen": chosen?["name"] as? String ?? "unknown",
        "screens": list,
        "sdrWhiteNits": SDR_WHITE_NITS,
        "version": 1,
    ]
}

func jsonData(_ obj: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: obj, options: [])) ?? Data("{}".utf8)
}

// ── CLI：打印一次 ────────────────────────────────────────────────
let args = CommandLine.arguments

if args.contains("--json") {
    print(String(data: jsonData(screenPayload()), encoding: .utf8) ?? "{}")
    exit(0)
}

// ── HTTP 服务 ────────────────────────────────────────────────────
var port: UInt16 = 8765
if let i = args.firstIndex(of: "--port"), i + 1 < args.count, let p = UInt16(args[i + 1]) {
    port = p
}

let queue = DispatchQueue(label: "metalhdr.meter")
guard let listener = try? NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!) else {
    FileHandle.standardError.write(Data("metalhdr-meter: cannot bind port \(port)\n".utf8))
    exit(1)
}

func respond(_ conn: NWConnection, body: Data) {
    var head = "HTTP/1.1 200 OK\r\n"
    head += "Content-Type: application/json; charset=utf-8\r\n"
    head += "Access-Control-Allow-Origin: *\r\n"
    head += "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
    head += "Access-Control-Allow-Headers: *\r\n"
    head += "Cache-Control: no-store\r\n"
    head += "Content-Length: \(body.count)\r\n"
    head += "Connection: close\r\n\r\n"
    var out = Data(head.utf8)
    out.append(body)
    conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
}

listener.newConnectionHandler = { conn in
    conn.start(queue: queue)
    conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
        let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        if text.hasPrefix("OPTIONS") {
            respond(conn, body: Data("{}".utf8))
        } else {
            respond(conn, body: jsonData(screenPayload()))
        }
    }
}

listener.stateUpdateHandler = { state in
    switch state {
    case .ready:
        FileHandle.standardError.write(Data("metalhdr-meter: listening on 127.0.0.1:\(port)\n".utf8))
    case .failed(let err):
        FileHandle.standardError.write(Data("metalhdr-meter: failed \(err)\n".utf8))
        exit(1)
    default:
        break
    }
}

listener.start(queue: queue)
dispatchMain()
