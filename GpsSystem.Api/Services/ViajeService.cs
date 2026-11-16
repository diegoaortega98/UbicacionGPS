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

    public async Task RechazarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken)
    {
        var disponible = await dbContext.Viajes.AsNoTracking().AnyAsync(
            viaje => viaje.Id == viajeId
                && viaje.Estado == EstadosViaje.Solicitado
                && viaje.ConductorId == null,
            cancellationToken);
        if (!disponible)
        {
            throw new InvalidOperationException("El viaje ya no está disponible.");
        }
    }

    public async Task<ViajeResponse> MarcarLlegandoAsync(
        Guid viajeId,
        string conductorId,
        CancellationToken cancellationToken)
    {
        var affected = await dbContext.Viajes
            .Where(viaje => viaje.Id == viajeId
                && viaje.ConductorId == conductorId
                && viaje.Estado == EstadosViaje.Aceptado)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(viaje => viaje.Estado, EstadosViaje.Llegando), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El viaje no está asignado a este conductor o ya cambió de estado.");
        }

        return await ObtenerRespuestaAsync(viajeId, cancellationToken);
    }

    public async Task<ViajeResponse> CancelarAsync(
        Guid viajeId,
        string usuarioId,
        CancellationToken cancellationToken)
    {
        var viaje = await dbContext.Viajes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == viajeId, cancellationToken)
            ?? throw new KeyNotFoundException("No se encontró el viaje.");

        Console.WriteLine(
            $"Validando cancelación - Viaje ID: {viajeId} | ConductorId en BD: {viaje.ConductorId} | PasajeroId en BD: {viaje.PasajeroId} | UsuarioId del Token: {usuarioId}");
        var esPasajero = viaje.PasajeroId == usuarioId;
        var esConductor = viaje.ConductorId == usuarioId;
        if (!esPasajero && !esConductor)
        {
            throw new UnauthorizedAccessException("Este usuario no participa en el viaje.");
        }

        var puedeCancelar = (esPasajero
                && (viaje.Estado == EstadosViaje.Solicitado
                    || viaje.Estado == EstadosViaje.Aceptado
                    || viaje.Estado == EstadosViaje.Llegando))
            || (esConductor
                && (viaje.Estado == EstadosViaje.Aceptado
                    || viaje.Estado == EstadosViaje.Llegando));
        if (!puedeCancelar)
        {
            throw new InvalidOperationException("El viaje no se puede cancelar en su estado actual.");
        }

        var affected = await dbContext.Viajes
            .Where(item => item.Id == viajeId
                && ((esPasajero && item.PasajeroId == usuarioId
                        && (item.Estado == EstadosViaje.Solicitado
                            || item.Estado == EstadosViaje.Aceptado
                            || item.Estado == EstadosViaje.Llegando))
                    || (esConductor && item.ConductorId == usuarioId
                        && (item.Estado == EstadosViaje.Aceptado
                            || item.Estado == EstadosViaje.Llegando))))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Estado, EstadosViaje.Cancelado), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El viaje no se puede cancelar en su estado actual.");
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

        if (viaje.Estado is not (EstadosViaje.Aceptado or EstadosViaje.Llegando))
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
                && (item.Estado == EstadosViaje.Aceptado || item.Estado == EstadosViaje.Llegando))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Estado, EstadosViaje.EnCurso), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El estado del viaje cambió. Actualiza e inténtalo de nuevo.");
        }

        return await ObtenerRespuestaAsync(viajeId, cancellationToken);
    }

    public async Task<FinalizacionViajeResponse> FinalizarAsync(
        Guid viajeId,
        string conductorId,
        CancellationToken cancellationToken)
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
                .SetProperty(item => item.Estado, EstadosViaje.PendientePago)
                .SetProperty(item => item.ComisionPlataforma, comision)
                .SetProperty(item => item.FechaFinalizacion, finalizacion), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El viaje ya no está en curso.");
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
        var viajeActualizado = await ObtenerRespuestaAsync(viajeId, cancellationToken);
        return new FinalizacionViajeResponse(
            viajeActualizado,
            viaje.Precio,
            comision,
            viaje.Precio - comision);
    }

    public async Task<ViajeResponse> ConfirmarPagoRecibidoAsync(
        Guid viajeId,
        string conductorId,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var viaje = await dbContext.Viajes.SingleOrDefaultAsync(
            item => item.Id == viajeId && item.ConductorId == conductorId,
            cancellationToken) ?? throw new KeyNotFoundException("No se encontró el viaje asignado.");

        if (viaje.Estado != EstadosViaje.PendientePago)
        {
            throw new InvalidOperationException("El viaje no está pendiente de confirmar el pago.");
        }

        var pago = await dbContext.Transacciones.SingleOrDefaultAsync(
            item => item.ViajeId == viajeId,
            cancellationToken) ?? throw new InvalidOperationException("No se encontró el cobro pendiente del viaje.");
        var affected = await dbContext.Viajes
            .Where(item => item.Id == viajeId
                && item.ConductorId == conductorId
                && item.Estado == EstadosViaje.PendientePago)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Estado, EstadosViaje.Finalizado), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El estado del viaje cambió. Actualiza e inténtalo de nuevo.");
        }

        pago.Estado = "Pagado";
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await ObtenerRespuestaAsync(viajeId, cancellationToken);
    }

    public async Task<decimal> ObtenerGananciasAsync(string conductorId, CancellationToken cancellationToken)
    {
        var viajes = dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.ConductorId == conductorId && viaje.Estado == EstadosViaje.Finalizado)
            .Select(viaje => new { viaje.Precio, viaje.ComisionPlataforma });
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var importes = await viajes.ToListAsync(cancellationToken);
            return importes.Sum(viaje => viaje.Precio - viaje.ComisionPlataforma);
        }

        return await viajes.SumAsync(
            viaje => viaje.Precio - viaje.ComisionPlataforma,
            cancellationToken);
    }

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerDisponiblesAsync(CancellationToken cancellationToken)
    {
        var limiteReciente = DateTimeOffset.UtcNow.AddMinutes(-10);
        var esSqlite = dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite";
        var consulta = dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Where(viaje => viaje.Estado == EstadosViaje.Solicitado);
        if (esSqlite)
        {
            var solicitudes = await consulta
                .ToListAsync(cancellationToken);
            return solicitudes
                .Select(Mapear)
                .Where(viaje => viaje.FechaCreacion >= limiteReciente)
                .OrderBy(viaje => viaje.FechaCreacion)
                .ToArray();
        }

        return await consulta
            .Where(viaje => viaje.FechaCreacion >= limiteReciente)
            .OrderBy(viaje => viaje.FechaCreacion)
            .Select(viaje => Mapear(viaje))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerPropiosAsync(
        string usuarioId,
        string rol,
        CancellationToken cancellationToken)
    {
        IQueryable<Viaje> viajes = dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Include(viaje => viaje.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor);
        viajes = rol == RolesUsuario.Conductor
            ? viajes.Where(viaje => viaje.ConductorId == usuarioId)
            : viajes.Where(viaje => viaje.PasajeroId == usuarioId);

        return await viajes.OrderByDescending(viaje => viaje.FechaCreacion)
            .Select(viaje => Mapear(viaje))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerHistorialAsync(
        string usuarioId,
        CancellationToken cancellationToken)
    {
        var historial = dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Include(viaje => viaje.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor)
            .Where(viaje => (viaje.PasajeroId == usuarioId || viaje.ConductorId == usuarioId)
                && (viaje.Estado == EstadosViaje.Finalizado || viaje.Estado == EstadosViaje.Cancelado));

        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var viajes = await historial.ToListAsync(cancellationToken);
            return viajes
                .OrderByDescending(viaje => viaje.FechaFinalizacion ?? viaje.FechaCreacion)
                .Take(20)
                .Select(Mapear)
                .ToArray();
        }

        return await historial
            .OrderByDescending(viaje => viaje.FechaFinalizacion ?? viaje.FechaCreacion)
            .Take(20)
            .Select(viaje => Mapear(viaje))
            .ToListAsync(cancellationToken);
    }

    public async Task<ViajeResponse?> ObtenerAsync(Guid viajeId, string usuarioId, CancellationToken cancellationToken)
    {
        var viaje = await dbContext.Viajes.AsNoTracking()
            .Include(item => item.Pasajero)
            .Include(item => item.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor)
            .Where(item => item.Id == viajeId
                && (item.PasajeroId == usuarioId || item.ConductorId == usuarioId))
            .Select(item => Mapear(item))
            .SingleOrDefaultAsync(cancellationToken);
        return viaje;
    }

    public async Task<ViajeResponse> CalificarAsync(
        Guid viajeId,
        string pasajeroId,
        CalificarViajeRequest request,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var viaje = await dbContext.Viajes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == viajeId, cancellationToken)
            ?? throw new KeyNotFoundException("No se encontró el viaje.");

        if (viaje.PasajeroId != pasajeroId)
        {
            throw new UnauthorizedAccessException("Solo el pasajero del viaje puede calificarlo.");
        }

        if (viaje.Estado != EstadosViaje.Finalizado)
        {
            throw new InvalidOperationException("Solo se pueden calificar viajes finalizados.");
        }

        if (viaje.Calificacion.HasValue)
        {
            throw new InvalidOperationException("Este viaje ya fue calificado.");
        }

        if (string.IsNullOrWhiteSpace(viaje.ConductorId))
        {
            throw new InvalidOperationException("No se encontró un conductor para este viaje.");
        }

        var comentario = string.IsNullOrWhiteSpace(request.Comentario)
            ? null
            : request.Comentario.Trim();
        var affectedTrips = await dbContext.Viajes
            .Where(item => item.Id == viajeId
                && item.PasajeroId == pasajeroId
                && item.Estado == EstadosViaje.Finalizado
                && item.Calificacion == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Calificacion, request.Estrellas)
                .SetProperty(item => item.ComentarioCalificacion, comentario), cancellationToken);

        if (affectedTrips == 0)
        {
            throw new InvalidOperationException("Este viaje ya fue calificado o dejó de estar finalizado.");
        }

        var affectedDrivers = await dbContext.Users
            .Where(usuario => usuario.Id == viaje.ConductorId && usuario.Rol == RolesUsuario.Conductor)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(usuario => usuario.PromedioCalificacion,
                    usuario => (usuario.PromedioCalificacion * usuario.TotalCalificaciones + request.Estrellas)
                        / (usuario.TotalCalificaciones + 1))
                .SetProperty(usuario => usuario.TotalCalificaciones,
                    usuario => usuario.TotalCalificaciones + 1), cancellationToken);

        if (affectedDrivers == 0)
        {
            throw new KeyNotFoundException("No se encontró el conductor asociado al viaje.");
        }

        await transaction.CommitAsync(cancellationToken);
        return await ObtenerRespuestaAsync(viajeId, cancellationToken);
    }

    private async Task<ViajeResponse> ObtenerRespuestaAsync(Guid viajeId, CancellationToken cancellationToken) =>
        await dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Include(viaje => viaje.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor)
            .Where(viaje => viaje.Id == viajeId)
            .Select(viaje => Mapear(viaje))
            .SingleAsync(cancellationToken);

    private static ViajeResponse Mapear(Viaje viaje) =>
        new(viaje.Id, viaje.PasajeroId, viaje.ConductorId,
            viaje.OrigenLat, viaje.OrigenLng, viaje.DestinoLat, viaje.DestinoLng,
            viaje.Estado, viaje.Precio, viaje.ComisionPlataforma, viaje.FechaCreacion,
            string.IsNullOrWhiteSpace(viaje.Pasajero.Nombre)
                ? viaje.Pasajero.Email
                : viaje.Pasajero.Nombre,
            viaje.Conductor == null ? null : viaje.Conductor.PerfilConductor == null ? null : viaje.Conductor.PerfilConductor.Vehiculo,
            viaje.Conductor == null ? null : viaje.Conductor.PerfilConductor == null ? null : viaje.Conductor.PerfilConductor.Placa,
            viaje.Conductor == null
                ? null
                : string.IsNullOrWhiteSpace(viaje.Conductor.Nombre)
                    ? viaje.Conductor.Email ?? "Conductor"
                    : viaje.Conductor.Nombre,
            viaje.Conductor == null ? null : viaje.Conductor.Telefono,
            viaje.Calificacion,
            viaje.ComentarioCalificacion);

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
