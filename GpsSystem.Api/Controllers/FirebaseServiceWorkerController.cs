using System.Text.Json;
using GpsSystem.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GpsSystem.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("firebase-messaging-sw.js")]
public class FirebaseServiceWorkerController(IConfiguration configuration) : ControllerBase
{
    [HttpGet]
    [Produces("application/javascript")]
    public IActionResult ObtenerServiceWorker()
    {
        var web = configuration.GetSection("Firebase:Web");
        var webConfig = new FirebaseWebConfigResponse(
            web["ApiKey"],
            web["AuthDomain"],
            web["ProjectId"],
            web["StorageBucket"],
            web["MessagingSenderId"],
            web["AppId"],
            web["VapidKey"]);
        var firebaseConfig = JsonSerializer.Serialize(webConfig, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Response.Headers["Service-Worker-Allowed"] = "/";

        var script = $$"""
            importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
            importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');
            firebase.initializeApp({{firebaseConfig}});
            const messaging = firebase.messaging();
            messaging.onBackgroundMessage((payload) => {
                console.log('Mensaje Firebase en segundo plano:', payload);
            });
            self.addEventListener('notificationclick', (event) => {
                event.notification.close();
                event.waitUntil(self.clients.openWindow('/'));
            });
            """;

        return Content(script, "application/javascript");
    }
}
