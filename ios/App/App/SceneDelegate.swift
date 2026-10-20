import UIKit
import Capacitor
import CoreLocation

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = UbicacionGPSBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

class UbicacionGPSBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Registra la implementación nativa dentro del puente de Capacitor.
        bridge?.registerPluginInstance(BackgroundLocationPlugin())
    }
}

@objc(BackgroundLocationPlugin)
public class BackgroundLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "BackgroundLocationPlugin"
    public let jsName = "BackgroundLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    private let locationManager = CLLocationManager()
    private var permissionCall: CAPPluginCall?
    private var didRequestAlwaysUpgrade = false
    private var endpoint: URL?
    private var deviceId: String?

    @objc override public func load() {
        super.load()
        locationManager.delegate = self
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 10
    }

    @objc func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(permissionStatus())
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        guard CLLocationManager.locationServicesEnabled() else {
            call.reject("Activa los servicios de ubicación del dispositivo.")
            return
        }

        switch locationManager.authorizationStatus {
        case .authorizedAlways:
            call.resolve(permissionStatus())
        case .notDetermined, .authorizedWhenInUse:
            permissionCall = call
            locationManager.requestAlwaysAuthorization()
        default:
            call.resolve(permissionStatus())
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https",
              let requestedDeviceId = call.getString("deviceId"),
              requestedDeviceId.range(of: "^[A-Za-z0-9_-]{16,80}$", options: .regularExpression) != nil else {
            call.reject("Configura un endpoint HTTPS y un identificador de dispositivo válido.")
            return
        }
        guard locationManager.authorizationStatus == .authorizedAlways else {
            call.reject("Concede acceso a la ubicación 'Siempre' antes de iniciar el rastreo.")
            return
        }

        endpoint = url
        deviceId = requestedDeviceId
        locationManager.startUpdatingLocation()
        call.resolve(["running": true])
    }

    @objc func stop(_ call: CAPPluginCall) {
        locationManager.stopUpdatingLocation()
        endpoint = nil
        deviceId = nil
        call.resolve(["running": false])
    }

    @objc func openAppSettings(_ call: CAPPluginCall) {
        guard let settingsUrl = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("No se pudo abrir la configuración del dispositivo.")
            return
        }
        UIApplication.shared.open(settingsUrl) { opened in
            if opened {
                call.resolve()
            } else {
                call.reject("No se pudo abrir la configuración del dispositivo.")
            }
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let call = permissionCall else { return }
        if manager.authorizationStatus == .authorizedWhenInUse && !didRequestAlwaysUpgrade {
            didRequestAlwaysUpgrade = true
            manager.requestAlwaysAuthorization()
            return
        }
        permissionCall = nil
        call.resolve(permissionStatus())
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let coordinates: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude
        ]
        notifyListeners("location", data: coordinates)

        guard let endpoint, let deviceId else { return }
        // La URL se valida como HTTPS al iniciar para no enviar coordenadas en texto plano.
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "deviceId": deviceId,
            "lat": location.coordinate.latitude,
            "lng": location.coordinate.longitude
        ])
        URLSession.shared.dataTask(with: request) { _, response, error in
            if let error {
                NSLog("No se pudo enviar la ubicación al servidor: %@", error.localizedDescription)
                return
            }
            if let response = response as? HTTPURLResponse, !(200...299).contains(response.statusCode) {
                NSLog("El servidor rechazó la ubicación. HTTP %ld", response.statusCode)
            }
        }.resume()
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("Error de ubicación en segundo plano: %@", error.localizedDescription)
    }

    private func permissionStatus() -> [String: Any] {
        let status = locationManager.authorizationStatus
        return [
            "location": status == .authorizedAlways || status == .authorizedWhenInUse,
            "backgroundLocation": status == .authorizedAlways
        ]
    }
}
