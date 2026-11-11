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
        await viajeHub.Clients.Group(ViajeHub.GrupoConductores)
            .SendAsync("NuevaSolicitud", new
            {
                solicitud.Id,
                solicitud.Estado,
                solicitud.Precio,
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
    [Authorize(Roles = RolesUsuario.Conductor)]
    public async Task<IActionResult> Disponibles(CancellationToken cancellationToken) =>
        Ok(await viajeService.ObtenerDisponiblesAsync(cancellationToken));

    [HttpGet("mios")]
    public async Task<IActionResult> Mios(CancellationToken cancellationToken) =>
        Ok(await viajeService.ObtenerPropiosAsync(UsuarioId(), RolUsuario(), cancellationToken));

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
        var conductor = await userManager.FindByIdAsync(viaje.ConductorId!)
            ?? throw new InvalidOperationException("No se encontró el conductor asignado al viaje.");
        await viajeHub.Clients.Group(ViajeHub.GrupoViaje(viaje.Id))
            .SendAsync("ViajeAceptado", new
            {
                viajeId = viaje.Id,
                conductorNombre = conductor.UserName ?? conductor.Email ?? "Conductor",
                conductorTelefono = conductor.Telefono
            }, cancellationToken);
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
        var viaje = await viajeService.FinalizarAsync(id, UsuarioId(), cancellationToken);
        await NotificarViajeAsync(viaje, cancellationToken);
        return Ok(viaje);
    }

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
