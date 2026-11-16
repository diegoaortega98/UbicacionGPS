using System.Security.Claims;
using GpsSystem.Api.Hubs;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/viajes")]
public class ViajesController(
    IViajeService viajeService,
    IHubContext<ViajeHub> viajeHub,
    NotificacionService notificacionService,
    UserManager<Usuario> userManager) : ControllerBase
{
    [HttpPost("solicitar")]
    [Authorize(Roles = RolesUsuario.Pasajero)]
    [ProducesResponseType<SolicitudViajeResponse>(StatusCodes.Status201Created)]
    public async Task<IActionResult> Solicitar(
        [FromBody] SolicitarViajeRequest request,
        CancellationToken cancellationToken)
    {
        var pasajeroId = UsuarioId();
        var solicitud = await viajeService.SolicitarAsync(pasajeroId, request, cancellationToken);
        var pasajero = await userManager.FindByIdAsync(pasajeroId)
            ?? throw new InvalidOperationException("No se encontró el pasajero que solicitó el viaje.");
        await viajeHub.Clients.Group(ViajeHub.GrupoConductores)
            .SendAsync("NuevaSolicitud", new
            {
                solicitud.Id,
                solicitud.Estado,
                solicitud.Precio,
                pasajeroNombre = pasajero.Email,
                request.OrigenLat,
                request.OrigenLng,
                request.DestinoLat,
                request.DestinoLng
            }, cancellationToken);
        await notificacionService.NotificarConductoresNuevaSolicitudAsync(
            solicitud.Id, solicitud.Precio, cancellationToken);
        return Created($"/api/viajes/{solicitud.Id}", solicitud);
    }

    [HttpGet("disponibles")]
    [HttpGet("pendientes")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> Disponibles(CancellationToken cancellationToken) =>
        Ok(await viajeService.ObtenerDisponiblesAsync(cancellationToken));

    [HttpGet("mios")]
    public async Task<IActionResult> Mios(CancellationToken cancellationToken) =>
        Ok(await viajeService.ObtenerPropiosAsync(UsuarioId(), RolUsuario(), cancellationToken));

    [HttpGet("historial")]
    [ProducesResponseType<IReadOnlyList<ViajeResponse>>(StatusCodes.Status200OK)]
    public async Task<IActionResult> Historial(CancellationToken cancellationToken) =>
        Ok(await viajeService.ObtenerHistorialAsync(UsuarioId(), cancellationToken));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Obtener(Guid id, CancellationToken cancellationToken)
    {
        var viaje = await viajeService.ObtenerAsync(id, UsuarioId(), cancellationToken);
        return viaje is null ? NotFound() : Ok(viaje);
    }

    [HttpPost("{id:guid}/aceptar")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> Aceptar(Guid id, CancellationToken cancellationToken)
    {
        var viaje = await viajeService.AceptarAsync(id, UsuarioId(), cancellationToken);
        await viajeHub.Clients.Group(ViajeHub.GrupoViaje(viaje.Id))
            .SendAsync("ViajeAceptado", viaje, cancellationToken);
        await NotificarViajeAsync(viaje, cancellationToken);
        return Ok(viaje);
    }

    [HttpPost("{id:guid}/rechazar")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> Rechazar(Guid id, CancellationToken cancellationToken)
    {
        await viajeService.RechazarAsync(id, UsuarioId(), cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:guid}/llegando")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> Llegando(Guid id, CancellationToken cancellationToken)
    {
        var viaje = await viajeService.MarcarLlegandoAsync(id, UsuarioId(), cancellationToken);
        await viajeHub.Clients.Group(ViajeHub.GrupoViaje(viaje.Id))
            .SendAsync("ConductorLlegando", new { viajeId = viaje.Id }, cancellationToken);
        await NotificarViajeAsync(viaje, cancellationToken);
        return Ok(viaje);
    }

    [HttpPost("{id:guid}/iniciar")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> Iniciar(
        Guid id,
        [FromBody] IniciarViajeRequest request,
        CancellationToken cancellationToken)
    {
        var viaje = await viajeService.IniciarAsync(id, UsuarioId(), request.Pin, cancellationToken);
        await NotificarViajeAsync(viaje, cancellationToken);
        return Ok(viaje);
    }

    [HttpPost("{id:guid}/finalizar")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> Finalizar(Guid id, CancellationToken cancellationToken)
    {
        var resumen = await viajeService.FinalizarAsync(id, UsuarioId(), cancellationToken);
        await NotificarViajeAsync(resumen.Viaje, cancellationToken);
        return Ok(resumen);
    }

    [HttpPost("{id:guid}/cancelar")]
    [Authorize]
    public async Task<IActionResult> Cancelar(Guid id, CancellationToken cancellationToken)
    {
        Console.WriteLine("--- INTENTO DE CANCELACIÓN ---");
        Console.WriteLine($"User.Identity.IsAuthenticated: {User.Identity?.IsAuthenticated}");
        Console.WriteLine(
            $"User Roles: {string.Join(", ", User.Claims.Where(c => c.Type == ClaimTypes.Role).Select(c => c.Value))}");
        Console.WriteLine(
            $"User ID (NameIdentifier): {User.FindFirstValue(ClaimTypes.NameIdentifier)}");
        var usuarioId = UsuarioId();
        var viaje = await viajeService.CancelarAsync(id, usuarioId, cancellationToken);
        var rol = viaje.ConductorId == usuarioId ? RolesUsuario.Conductor : RolesUsuario.Pasajero;
        await viajeHub.Clients.Group(ViajeHub.GrupoViaje(viaje.Id))
            .SendAsync("ViajeCancelado", new
            {
                viajeId = viaje.Id,
                canceladoPor = rol
            }, cancellationToken);
        await NotificarViajeAsync(viaje, cancellationToken);
        return Ok(viaje);
    }

    [HttpPost("{id:guid}/pago-recibido")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> ConfirmarPagoRecibido(Guid id, CancellationToken cancellationToken)
    {
        var viaje = await viajeService.ConfirmarPagoRecibidoAsync(id, UsuarioId(), cancellationToken);
        await NotificarViajeAsync(viaje, cancellationToken);
        return Ok(viaje);
    }

    [HttpPost("{id:guid}/calificar")]
    [Authorize(Roles = RolesUsuario.Pasajero)]
    [ProducesResponseType<ViajeResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Calificar(
        Guid id,
        [FromBody] CalificarViajeRequest request,
        CancellationToken cancellationToken) =>
        Ok(await viajeService.CalificarAsync(id, UsuarioId(), request, cancellationToken));

    [HttpGet("ganancias")]
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<ActionResult<GananciasResponse>> Ganancias(CancellationToken cancellationToken) =>
        Ok(new GananciasResponse(await viajeService.ObtenerGananciasAsync(UsuarioId(), cancellationToken)));

    private async Task NotificarViajeAsync(ViajeResponse viaje, CancellationToken cancellationToken)
    {
        await viajeHub.Clients.Group(ViajeHub.GrupoViaje(viaje.Id))
            .SendAsync("ActualizarViaje", viaje, cancellationToken);
        await notificacionService.NotificarParticipantesAsync(viaje, cancellationToken);
    }

    private string UsuarioId() =>
        User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new UnauthorizedAccessException("No se pudo identificar al usuario autenticado.");

    private string RolUsuario() =>
        User.FindFirstValue(ClaimTypes.Role)
        ?? throw new UnauthorizedAccessException("No se pudo identificar el rol del usuario.");
}
