using System.Security.Claims;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Route("api/notificaciones")]
public class NotificacionesController(
    IConfiguration configuration,
    NotificacionService notificacionService) : ControllerBase
{
    [AllowAnonymous]
    [HttpGet("config")]
    [ProducesResponseType<FirebaseWebConfigResponse>(StatusCodes.Status200OK)]
    public ActionResult<FirebaseWebConfigResponse> ObtenerConfiguracionWeb()
    {
        var web = configuration.GetSection("Firebase:Web");
        return Ok(new FirebaseWebConfigResponse(
            web["ApiKey"],
            web["AuthDomain"],
            web["ProjectId"],
            web["StorageBucket"],
            web["MessagingSenderId"],
            web["AppId"],
            web["VapidKey"]));
    }

    [Authorize]
    [HttpPost("token")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> RegistrarToken(
        [FromBody] RegistrarTokenNotificacionRequest request,
        CancellationToken cancellationToken)
    {
        await notificacionService.RegistrarTokenAsync(UsuarioId(), request.Token.Trim(), cancellationToken);
        return NoContent();
    }

    [Authorize]
    [HttpDelete("token")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> QuitarToken(
        [FromBody] RegistrarTokenNotificacionRequest request,
        CancellationToken cancellationToken)
    {
        await notificacionService.QuitarTokenAsync(UsuarioId(), request.Token.Trim(), cancellationToken);
        return NoContent();
    }

    private string UsuarioId() =>
        User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new UnauthorizedAccessException("No se pudo identificar al usuario autenticado.");
}
