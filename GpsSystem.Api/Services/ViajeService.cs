using System.Security.Cryptography;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Services;

public sealed class ViajeService(AppDbContext dbContext, ITokenService tokenService) : IViajeService
{
    public async Task<SolicitudViajeResponse> SolicitarAsync(
        string pasajeroId,
        SolicitarViajeRequest request,
        CancellationToken cancellationToken)
    {
        var pin = RandomNumberGenerator.GetInt32(0, 10_000).ToString("D4");
        var viaje = new Viaje
        {
            PasajeroId = pasajeroId,
            OrigenLat = request.OrigenLat,
            OrigenLng = request.OrigenLng,
            DestinoLat = request.DestinoLat,
            DestinoLng = request.DestinoLng,
            Pin = tokenService.ProtegerPin(pin),
            Precio = CalcularTarifa(request)
        };

        dbContext.Viajes.Add(viaje);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new SolicitudViajeResponse(viaje.Id, viaje.Estado, pin, viaje.Precio, viaje.FechaCreacion);
    }

    public async Task<ViajeResponse> AceptarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken)
    {
        if (!await dbContext.PerfilesConductores.AnyAsync(perfil => perfil.UsuarioId == conductorId, cancellationToken))
        {
            throw new InvalidOperationException("El conductor debe completar su perfil antes de aceptar viajes.");
        }

        var affected = await dbContext.Viajes
            .Where(viaje => viaje.Id == viajeId
                && viaje.Estado == EstadosViaje.Solicitado
                && viaje.ConductorId == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(viaje => viaje.ConductorId, conductorId)
                .SetProperty(viaje => viaje.Estado, EstadosViaje.Aceptado), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El viaje ya no está disponible.");
        }

        return await ObtenerRespuestaAsync(viajeId, cancellationToken);
    }

    public async Task<ViajeResponse> IniciarAsync(
        Guid viajeId,
        string conductorId,
        string pin,
        CancellationToken cancellationToken)
    {
        var viaje = await dbContext.Viajes.SingleOrDefaultAsync(
            item => item.Id == viajeId && item.ConductorId == conductorId,
            cancellationToken) ?? throw new KeyNotFoundException("No se encontró el viaje asignado.");

        if (viaje.Estado != EstadosViaje.Aceptado)
        {
            throw new InvalidOperationException("El viaje no está listo para iniciarse.");
        }

        if (!tokenService.VerificarPin(pin, viaje.Pin))
        {
            throw new ArgumentException("El PIN no es válido.");
        }

        var affected = await dbContext.Viajes
            .Where(item => item.Id == viajeId
                && item.ConductorId == conductorId
                && item.Estado == EstadosViaje.Aceptado)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Estado, EstadosViaje.EnCurso), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El estado del viaje cambió. Actualiza e inténtalo de nuevo.");
        }

        return await ObtenerRespuestaAsync(viajeId, cancellationToken);
    }

    public async Task<ViajeResponse> FinalizarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var viaje = await dbContext.Viajes.SingleOrDefaultAsync(
            item => item.Id == viajeId && item.ConductorId == conductorId,
            cancellationToken) ?? throw new KeyNotFoundException("No se encontró el viaje asignado.");

        if (viaje.Estado != EstadosViaje.EnCurso)
        {
            throw new InvalidOperationException("Solo se pueden finalizar viajes en curso.");
        }

        var comision = decimal.Round(viaje.Precio * 0.15m, 2, MidpointRounding.AwayFromZero);
        var finalizacion = DateTimeOffset.UtcNow;
        var affected = await dbContext.Viajes
            .Where(item => item.Id == viajeId && item.ConductorId == conductorId && item.Estado == EstadosViaje.EnCurso)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Estado, EstadosViaje.Finalizado)
                .SetProperty(item => item.ComisionPlataforma, comision)
                .SetProperty(item => item.FechaFinalizacion, finalizacion), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El viaje ya fue finalizado.");
        }

        dbContext.Transacciones.Add(new Transaccion
        {
            ViajeId = viajeId,
            Monto = viaje.Precio,
            Comision = comision,
            Estado = "Pendiente",
            FechaCreacion = finalizacion
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await ObtenerRespuestaAsync(viajeId, cancellationToken);
    }

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerDisponiblesAsync(CancellationToken cancellationToken) =>
        await dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.Estado == EstadosViaje.Solicitado)
            .OrderBy(viaje => viaje.FechaCreacion)
            .Select(viaje => Mapear(viaje))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerPropiosAsync(
        string usuarioId,
        string rol,
        CancellationToken cancellationToken)
    {
        var viajes = dbContext.Viajes.AsNoTracking();
        viajes = rol == RolesUsuario.Conductor
            ? viajes.Where(viaje => viaje.ConductorId == usuarioId)
            : viajes.Where(viaje => viaje.PasajeroId == usuarioId);

        return await viajes.OrderByDescending(viaje => viaje.FechaCreacion)
            .Select(viaje => Mapear(viaje))
            .ToListAsync(cancellationToken);
    }

    public async Task<ViajeResponse?> ObtenerAsync(Guid viajeId, string usuarioId, CancellationToken cancellationToken)
    {
        var viaje = await dbContext.Viajes.AsNoTracking()
            .Where(item => item.Id == viajeId
                && (item.PasajeroId == usuarioId || item.ConductorId == usuarioId))
            .Select(item => Mapear(item))
            .SingleOrDefaultAsync(cancellationToken);
        return viaje;
    }

    private async Task<ViajeResponse> ObtenerRespuestaAsync(Guid viajeId, CancellationToken cancellationToken) =>
        await dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.Id == viajeId)
            .Select(viaje => Mapear(viaje))
            .SingleAsync(cancellationToken);

    private static ViajeResponse Mapear(Viaje viaje) =>
        new(viaje.Id, viaje.PasajeroId, viaje.ConductorId,
            viaje.OrigenLat, viaje.OrigenLng, viaje.DestinoLat, viaje.DestinoLng,
            viaje.Estado, viaje.Precio, viaje.ComisionPlataforma, viaje.FechaCreacion,
            viaje.Conductor == null ? null : viaje.Conductor.PerfilConductor == null ? null : viaje.Conductor.PerfilConductor.Vehiculo,
            viaje.Conductor == null ? null : viaje.Conductor.PerfilConductor == null ? null : viaje.Conductor.PerfilConductor.Placa);

    private static decimal CalcularTarifa(SolicitarViajeRequest request)
    {
        const double earthRadiusKm = 6371;
        var lat1 = DegreesToRadians(request.OrigenLat);
        var lat2 = DegreesToRadians(request.DestinoLat);
        var deltaLat = DegreesToRadians(request.DestinoLat - request.OrigenLat);
        var deltaLng = DegreesToRadians(request.DestinoLng - request.OrigenLng);
        var haversine = Math.Pow(Math.Sin(deltaLat / 2), 2)
            + Math.Cos(lat1) * Math.Cos(lat2) * Math.Pow(Math.Sin(deltaLng / 2), 2);
        var distanceKm = 2 * earthRadiusKm * Math.Asin(Math.Sqrt(haversine)) * 1.3;
        var estimate = 5000m + (decimal)distanceKm * 1800m;
        return decimal.Ceiling(estimate / 500m) * 500m;
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180d;
}
