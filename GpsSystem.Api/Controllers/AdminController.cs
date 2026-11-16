using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
public sealed class AdminController(
    AppDbContext dbContext,
    IConductoresActivosTracker conductoresActivos) : ControllerBase
{
    [HttpGet("estadisticas")]
    [ProducesResponseType<AdminEstadisticasResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<AdminEstadisticasResponse>> ObtenerEstadisticas(
        CancellationToken cancellationToken)
    {
        if (!User.IsInRole(RolesUsuario.Admin))
        {
            return Forbid();
        }

        var viajesFinalizados = dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.Estado == EstadosViaje.Finalizado);
        var inicioHoyUtc = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        var finHoyUtc = inicioHoyUtc.AddDays(1);
        long totalViajes;
        decimal comisionesTotales;
        long viajesHoy;
        decimal recaudadoHoy;
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var fechasYComisiones = await viajesFinalizados
                .Select(viaje => new { viaje.FechaFinalizacion, viaje.ComisionPlataforma })
                .ToListAsync(cancellationToken);
            var hoy = fechasYComisiones.Where(viaje =>
                viaje.FechaFinalizacion >= inicioHoyUtc && viaje.FechaFinalizacion < finHoyUtc);
            totalViajes = fechasYComisiones.Count;
            comisionesTotales = fechasYComisiones.Sum(viaje => viaje.ComisionPlataforma);
            viajesHoy = hoy.LongCount();
            recaudadoHoy = hoy.Sum(viaje => viaje.ComisionPlataforma);
        }
        else
        {
            totalViajes = await viajesFinalizados.LongCountAsync(cancellationToken);
            comisionesTotales = await viajesFinalizados.SumAsync(
                viaje => viaje.ComisionPlataforma,
                cancellationToken);
            var viajesFinalizadosHoy = viajesFinalizados
                .Where(viaje => viaje.FechaFinalizacion >= inicioHoyUtc
                    && viaje.FechaFinalizacion < finHoyUtc);
            viajesHoy = await viajesFinalizadosHoy.LongCountAsync(cancellationToken);
            recaudadoHoy = await viajesFinalizadosHoy.SumAsync(
                viaje => viaje.ComisionPlataforma,
                cancellationToken);
        }

        var estadisticas = new AdminEstadisticasResponse(
            totalViajes,
            comisionesTotales,
            viajesHoy,
            conductoresActivos.TotalConductoresActivos,
            recaudadoHoy);

        return Ok(estadisticas);
    }
}
