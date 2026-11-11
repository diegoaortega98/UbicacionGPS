using GpsSystem.Api.Data;
using GpsSystem.Api.Hubs;
using GpsSystem.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Route("api/ubicaciones")]
public class UbicacionesController(
    AppDbContext dbContext,
    IHubContext<GpsHub> gpsHub,
    ILogger<UbicacionesController> logger) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Crear([FromBody] CrearUbicacionRequest request)
    {
        try
        {
            var dispositivo = await dbContext.Dispositivos.FindAsync(request.DispositivoId);
            if (dispositivo is null)
            {
                dispositivo = new Dispositivo
                {
                    Id = request.DispositivoId,
                    Nombre = request.DispositivoId
                };
                dbContext.Dispositivos.Add(dispositivo);
            }

            var fechaHora = request.FechaHora ?? DateTime.UtcNow;
            fechaHora = fechaHora.Kind switch
            {
                DateTimeKind.Unspecified => DateTime.SpecifyKind(fechaHora, DateTimeKind.Utc),
                DateTimeKind.Local => fechaHora.ToUniversalTime(),
                _ => fechaHora
            };

            var ubicacion = new Ubicacion
            {
                DispositivoId = dispositivo.Id,
                Latitud = request.Latitud,
                Longitud = request.Longitud,
                Velocidad = request.Velocidad,
                FechaHora = fechaHora
            };

            dbContext.Ubicaciones.Add(ubicacion);
            await dbContext.SaveChangesAsync();

            var respuesta = new
            {
                ubicacion.Id,
                ubicacion.DispositivoId,
                ubicacion.Latitud,
                ubicacion.Longitud,
                ubicacion.Velocidad,
                ubicacion.FechaHora
            };

            await gpsHub.Clients.All.SendAsync("RecibirUbicacion", respuesta);
            return Created($"/api/ubicaciones/historial/{ubicacion.DispositivoId}", respuesta);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "No se pudo guardar la ubicación del dispositivo {DispositivoId}.", request.DispositivoId);
            return Problem(statusCode: StatusCodes.Status500InternalServerError, title: "No se pudo guardar la ubicación.");
        }
    }

    [HttpGet("actual")]
    public async Task<IActionResult> ObtenerActuales()
    {
        try
        {
            var ultimasUbicaciones = dbContext.Ubicaciones
                .AsNoTracking()
                .GroupBy(ubicacion => ubicacion.DispositivoId)
                .Select(grupo => grupo.Max(ubicacion => ubicacion.Id));

            var resultado = await dbContext.Ubicaciones
                .AsNoTracking()
                .Where(ubicacion => ultimasUbicaciones.Contains(ubicacion.Id))
                .Select(ubicacion => new
                {
                    ubicacion.Id,
                    ubicacion.DispositivoId,
                    ubicacion.Latitud,
                    ubicacion.Longitud,
                    ubicacion.Velocidad,
                    ubicacion.FechaHora
                })
                .ToListAsync();

            return Ok(resultado);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "No se pudieron consultar las ubicaciones actuales.");
            return Problem(statusCode: StatusCodes.Status500InternalServerError, title: "No se pudieron consultar las ubicaciones.");
        }
    }

    [HttpGet("historial/{id}")]
    public async Task<IActionResult> ObtenerHistorial(string id)
    {
        try
        {
            var historial = await dbContext.Ubicaciones
                .AsNoTracking()
                .Where(ubicacion => ubicacion.DispositivoId == id)
                .OrderByDescending(ubicacion => ubicacion.FechaHora)
                .Select(ubicacion => new
                {
                    ubicacion.Id,
                    ubicacion.DispositivoId,
                    ubicacion.Latitud,
                    ubicacion.Longitud,
                    ubicacion.Velocidad,
                    ubicacion.FechaHora
                })
                .ToListAsync();

            return Ok(historial);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "No se pudo consultar el historial del dispositivo {DispositivoId}.", id);
            return Problem(statusCode: StatusCodes.Status500InternalServerError, title: "No se pudo consultar el historial.");
        }
    }
}
