using System.Security.Cryptography;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Services;

public sealed class ViajeService(
    AppDbContext dbContext,
    ITokenService tokenService,
    IPromocionService promocionService) : IViajeService
{
    public async Task<SolicitudViajeResponse> SolicitarAsync(
        string pasajeroId,
        SolicitarViajeRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Paradas?.Count > 3)
        {
            throw new ArgumentException("Un viaje puede incluir como máximo tres paradas.");
        }

        var pin = RandomNumberGenerator.GetInt32(0, 10_000).ToString("D4");
        Promocion? promocion = null;
        if (!string.IsNullOrWhiteSpace(request.CodigoPromo))
        {
            promocion = await promocionService.ObtenerValidaAsync(request.CodigoPromo, cancellationToken)
                ?? throw new ArgumentException("El código promocional no existe, está inactivo o expiró.");
        }

        var precio = CalcularTarifa(request);
        if (promocion is not null)
        {
            precio = decimal.Round(
                precio * (100m - promocion.PorcentajeDescuento) / 100m,
                2,
                MidpointRounding.AwayFromZero);
        }

        var viaje = new Viaje
        {
            PasajeroId = pasajeroId,
            OrigenLat = request.OrigenLat,
            OrigenLng = request.OrigenLng,
            DestinoLat = request.DestinoLat,
            DestinoLng = request.DestinoLng,
            Pin = tokenService.ProtegerPin(pin),
            Precio = precio,
            MetodoPago = request.MetodoPago,
            PromocionId = promocion?.Id,
            Paradas = (request.Paradas ?? [])
                .Select((parada, index) => new ParadaViaje
                {
                    Latitud = parada.Latitud,
                    Longitud = parada.Longitud,
                    Orden = index + 1
                })
                .ToList()
        };

        dbContext.Viajes.Add(viaje);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new SolicitudViajeResponse(
            viaje.Id,
            viaje.Estado,
            pin,
            viaje.Precio,
            viaje.FechaCreacion,
            MapearParadas(viaje.Paradas));
    }

    public async Task<ViajeResponse> AceptarAsync(Guid viajeId, string conductorId, CancellationToken cancellationToken)
    {
        var conductor = await dbContext.Users.AsNoTracking()
            .SingleOrDefaultAsync(usuario => usuario.Id == conductorId
                && usuario.Rol == RolesUsuario.Conductor,
                cancellationToken);
        if (conductor is null)
        {
            throw new InvalidOperationException(
                "Tu cuenta debe tener los documentos aprobados antes de aceptar viajes.");
        }

        if (conductor.EstadoVerificacion == EstadoVerificacionConductor.Aprobado
            && (!conductor.FechaVencimientoDocumentos.HasValue
                || conductor.FechaVencimientoDocumentos.Value.Date < DateTime.UtcNow.Date))
        {
            await dbContext.Users
                .Where(usuario => usuario.Id == conductorId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        usuario => usuario.EstadoVerificacion,
                        EstadoVerificacionConductor.Vencido),
                    cancellationToken);
            throw new InvalidOperationException("Tus documentos están vencidos. Actualízalos antes de aceptar viajes.");
        }

        if (conductor.EstadoVerificacion != EstadoVerificacionConductor.Aprobado)
        {
            throw new InvalidOperationException(
                "Tu cuenta debe tener los documentos aprobados antes de aceptar viajes.");
        }

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

        var comision = CalcularComision(viaje.Precio);
        var finalizacion = DateTimeOffset.UtcNow;
        var esEfectivo = viaje.MetodoPago == MetodosPago.Efectivo;
        var estadoFinal = esEfectivo ? EstadosViaje.PendientePago : EstadosViaje.Finalizado;
        var affected = await dbContext.Viajes
            .Where(item => item.Id == viajeId && item.ConductorId == conductorId && item.Estado == EstadosViaje.EnCurso)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(item => item.Estado, estadoFinal)
                .SetProperty(item => item.ComisionPlataforma, comision)
                .SetProperty(item => item.FechaFinalizacion, finalizacion), cancellationToken);

        if (affected == 0)
        {
            throw new InvalidOperationException("El viaje ya no está en curso.");
        }

        if (esEfectivo)
        {
            var conductorActualizado = await dbContext.Users
                .Where(usuario => usuario.Id == conductorId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        usuario => usuario.SaldoPendiente,
                        usuario => usuario.SaldoPendiente + comision),
                    cancellationToken);
            if (conductorActualizado == 0)
            {
                throw new InvalidOperationException("No se encontró el conductor para registrar el saldo pendiente.");
            }
        }

        dbContext.Transacciones.Add(new Transaccion
        {
            ViajeId = viajeId,
            Monto = viaje.Precio,
            Comision = comision,
            Estado = esEfectivo ? "Pendiente" : "Pagado",
            FechaCreacion = finalizacion
        });
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var viajeActualizado = await ObtenerRespuestaAsync(viajeId, cancellationToken);
        return new FinalizacionViajeResponse(
            viajeActualizado,
            viaje.Precio,
            comision,
            esEfectivo ? viaje.Precio : viaje.Precio - comision);
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
            .Select(viaje => new { viaje.Precio, viaje.ComisionPlataforma, viaje.MetodoPago });
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var importes = await viajes.ToListAsync(cancellationToken);
            return importes.Sum(viaje => GananciaNeta(viaje.Precio, viaje.ComisionPlataforma, viaje.MetodoPago));
        }

        return await viajes.SumAsync(
            viaje => viaje.MetodoPago == MetodosPago.Efectivo
                ? viaje.Precio
                : viaje.Precio - viaje.ComisionPlataforma,
            cancellationToken);
    }

    public async Task<EstadisticasFinancierasConductorResponse> ObtenerEstadisticasFinancierasConductorHoyAsync(
        string conductorId,
        CancellationToken cancellationToken)
    {
        var inicioHoyUtc = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        var finHoyUtc = inicioHoyUtc.AddDays(1);
        var finalizados = dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.ConductorId == conductorId
                && viaje.Estado == EstadosViaje.Finalizado);
        decimal totalRecaudado;
        List<(decimal Precio, decimal Comision, string MetodoPago)> viajesHoy;
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var viajes = await finalizados
                .Select(viaje => new
                {
                    viaje.FechaFinalizacion,
                    viaje.Precio,
                    viaje.ComisionPlataforma,
                    viaje.MetodoPago
                })
                .ToListAsync(cancellationToken);
            totalRecaudado = viajes.Sum(viaje => viaje.Precio);
            viajesHoy = viajes
                .Where(viaje => viaje.FechaFinalizacion >= inicioHoyUtc
                    && viaje.FechaFinalizacion < finHoyUtc)
                .Select(viaje => (
                    Precio: viaje.Precio,
                    Comision: viaje.ComisionPlataforma,
                    MetodoPago: viaje.MetodoPago))
                .ToList();
        }
        else
        {
            totalRecaudado = await finalizados.SumAsync(
                viaje => (decimal?)viaje.Precio,
                cancellationToken) ?? 0m;
            var viajes = await finalizados
                .Where(viaje => viaje.FechaFinalizacion >= inicioHoyUtc
                    && viaje.FechaFinalizacion < finHoyUtc)
                .Select(viaje => new
                {
                    viaje.Precio,
                    viaje.ComisionPlataforma,
                    viaje.MetodoPago
                })
                .ToListAsync(cancellationToken);
            viajesHoy = viajes
                .Select(viaje => (
                    Precio: viaje.Precio,
                    Comision: viaje.ComisionPlataforma,
                    MetodoPago: viaje.MetodoPago))
                .ToList();
        }

        var gananciaNeta = viajesHoy.Sum(viaje =>
            GananciaNeta(viaje.Precio, viaje.Comision, viaje.MetodoPago));
        var saldoPendiente = await dbContext.Users.AsNoTracking()
            .Where(usuario => usuario.Id == conductorId)
            .Select(usuario => usuario.SaldoPendiente)
            .SingleAsync(cancellationToken);
        return new EstadisticasFinancierasConductorResponse(
            totalRecaudado,
            gananciaNeta,
            saldoPendiente);
    }

    public async Task<IReadOnlyList<HistorialViajeConductorResponse>> ObtenerHistorialConductorAsync(
        string conductorId,
        CancellationToken cancellationToken)
    {
        var historial = dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.ConductorId == conductorId
                && viaje.Estado == EstadosViaje.Finalizado);
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var viajes = await historial.ToListAsync(cancellationToken);
            return viajes
                .OrderByDescending(viaje => viaje.FechaFinalizacion ?? viaje.FechaCreacion)
                .Take(50)
                .Select(viaje => new HistorialViajeConductorResponse(
                    viaje.Id,
                    viaje.FechaFinalizacion ?? viaje.FechaCreacion,
                    viaje.Precio,
                    viaje.ComisionPlataforma,
                    GananciaNeta(viaje.Precio, viaje.ComisionPlataforma, viaje.MetodoPago)))
                .ToArray();
        }

        return await historial
            .OrderByDescending(viaje => viaje.FechaFinalizacion ?? viaje.FechaCreacion)
            .Take(50)
            .Select(viaje => new HistorialViajeConductorResponse(
                viaje.Id,
                viaje.FechaFinalizacion ?? viaje.FechaCreacion,
                viaje.Precio,
                viaje.ComisionPlataforma,
                viaje.MetodoPago == MetodosPago.Efectivo
                    ? viaje.Precio
                    : viaje.Precio - viaje.ComisionPlataforma))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<HistorialViajePasajeroResponse>> ObtenerHistorialPasajeroAsync(
        string pasajeroId,
        CancellationToken cancellationToken)
    {
        var historial = dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.PasajeroId == pasajeroId
                && viaje.Estado == EstadosViaje.Finalizado)
            .Select(viaje => new
            {
                viaje.Id,
                Fecha = viaje.FechaFinalizacion ?? viaje.FechaCreacion,
                viaje.OrigenLat,
                viaje.OrigenLng,
                viaje.DestinoLat,
                viaje.DestinoLng,
                MontoPagado = viaje.Precio,
                ConductorNombre = viaje.Conductor == null ? null : viaje.Conductor.Nombre
            });

        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var viajes = await historial.ToListAsync(cancellationToken);
            return viajes
                .OrderByDescending(viaje => viaje.Fecha)
                .Take(50)
                .Select(viaje => new HistorialViajePasajeroResponse(
                    viaje.Id,
                    viaje.Fecha,
                    viaje.OrigenLat,
                    viaje.OrigenLng,
                    viaje.DestinoLat,
                    viaje.DestinoLng,
                    viaje.MontoPagado,
                    viaje.ConductorNombre))
                .ToArray();
        }

        return await historial
            .OrderByDescending(viaje => viaje.Fecha)
            .Take(50)
            .Select(viaje => new HistorialViajePasajeroResponse(
                viaje.Id,
                viaje.Fecha,
                viaje.OrigenLat,
                viaje.OrigenLng,
                viaje.DestinoLat,
                viaje.DestinoLng,
                viaje.MontoPagado,
                viaje.ConductorNombre))
            .ToListAsync(cancellationToken);
    }

    public async Task<EstadisticasPasajeroResponse> ObtenerEstadisticasPasajeroAsync(
        string pasajeroId,
        CancellationToken cancellationToken)
    {
        var viajes = dbContext.Viajes.AsNoTracking()
            .Where(viaje => viaje.PasajeroId == pasajeroId
                && viaje.Estado == EstadosViaje.Finalizado);
        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var importes = await viajes.Select(viaje => viaje.Precio).ToListAsync(cancellationToken);
            return new EstadisticasPasajeroResponse(importes.Count, importes.Sum());
        }

        var totalViajes = await viajes.CountAsync(cancellationToken);
        var totalGastado = await viajes.SumAsync(viaje => (decimal?)viaje.Precio, cancellationToken) ?? 0m;
        return new EstadisticasPasajeroResponse(totalViajes, totalGastado);
    }

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerDisponiblesAsync(CancellationToken cancellationToken)
    {
        var limiteReciente = DateTimeOffset.UtcNow.AddMinutes(-10);
        var esSqlite = dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite";
        var consulta = dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Include(viaje => viaje.Paradas)
            .Where(viaje => viaje.Estado == EstadosViaje.Solicitado);
        if (esSqlite)
        {
            var solicitudes = await consulta
                .ToListAsync(cancellationToken);
            var resultados = solicitudes
                .Select(Mapear)
                .Where(viaje => viaje.FechaCreacion >= limiteReciente)
                .OrderBy(viaje => viaje.FechaCreacion)
                .ToArray();
            return await AgregarTotalViajesAsync(resultados, cancellationToken);
        }

        var viajesDisponibles = await consulta
            .Where(viaje => viaje.FechaCreacion >= limiteReciente)
            .OrderBy(viaje => viaje.FechaCreacion)
            .ToListAsync(cancellationToken);
        return await AgregarTotalViajesAsync(viajesDisponibles.Select(Mapear).ToArray(), cancellationToken);
    }

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerPropiosAsync(
        string usuarioId,
        string rol,
        CancellationToken cancellationToken)
    {
        IQueryable<Viaje> viajes = dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Include(viaje => viaje.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor)
            .Include(viaje => viaje.Paradas);
        viajes = rol == RolesUsuario.Conductor
            ? viajes.Where(viaje => viaje.ConductorId == usuarioId)
            : viajes.Where(viaje => viaje.PasajeroId == usuarioId);

        var resultados = await viajes.OrderByDescending(viaje => viaje.FechaCreacion)
            .ToListAsync(cancellationToken);
        return await AgregarTotalViajesAsync(resultados.Select(Mapear).ToArray(), cancellationToken);
    }

    public async Task<IReadOnlyList<ViajeResponse>> ObtenerHistorialAsync(
        string usuarioId,
        CancellationToken cancellationToken)
    {
        var historial = dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Include(viaje => viaje.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor)
            .Include(viaje => viaje.Paradas)
            .Where(viaje => (viaje.PasajeroId == usuarioId || viaje.ConductorId == usuarioId)
                && (viaje.Estado == EstadosViaje.Finalizado || viaje.Estado == EstadosViaje.Cancelado));

        if (dbContext.Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite")
        {
            var viajes = await historial.ToListAsync(cancellationToken);
            var resultados = viajes
                .OrderByDescending(viaje => viaje.FechaFinalizacion ?? viaje.FechaCreacion)
                .Take(20)
                .Select(Mapear)
                .ToArray();
            return await AgregarTotalViajesAsync(resultados, cancellationToken);
        }

        var historialViajes = await historial
            .OrderByDescending(viaje => viaje.FechaFinalizacion ?? viaje.FechaCreacion)
            .Take(20)
            .ToListAsync(cancellationToken);
        return await AgregarTotalViajesAsync(historialViajes.Select(Mapear).ToArray(), cancellationToken);
    }

    public async Task<ViajeResponse?> ObtenerAsync(Guid viajeId, string usuarioId, CancellationToken cancellationToken)
    {
        var entidad = await dbContext.Viajes.AsNoTracking()
            .Include(item => item.Pasajero)
            .Include(item => item.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor)
            .Include(item => item.Paradas)
            .Where(item => item.Id == viajeId
                && (item.PasajeroId == usuarioId || item.ConductorId == usuarioId))
            .SingleOrDefaultAsync(cancellationToken);
        if (entidad is null) return null;

        var viaje = await AgregarTotalViajesAsync([Mapear(entidad)], cancellationToken);
        return viaje[0];
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

    private async Task<ViajeResponse> ObtenerRespuestaAsync(Guid viajeId, CancellationToken cancellationToken)
    {
        var viaje = await dbContext.Viajes.AsNoTracking()
            .Include(viaje => viaje.Pasajero)
            .Include(viaje => viaje.Conductor)
                .ThenInclude(conductor => conductor!.PerfilConductor)
            .Include(viaje => viaje.Paradas)
            .Where(viaje => viaje.Id == viajeId)
            .SingleAsync(cancellationToken);
        var resultados = await AgregarTotalViajesAsync([Mapear(viaje)], cancellationToken);
        return resultados[0];
    }

    private async Task<IReadOnlyList<ViajeResponse>> AgregarTotalViajesAsync(
        IReadOnlyList<ViajeResponse> viajes,
        CancellationToken cancellationToken)
    {
        if (viajes.Count == 0) return viajes;

        var pasajeroIds = viajes.Select(viaje => viaje.PasajeroId).Distinct().ToArray();
        var conductorIds = viajes.Where(viaje => viaje.ConductorId is not null)
            .Select(viaje => viaje.ConductorId!)
            .Distinct()
            .ToArray();

        var totalViajesPasajero = pasajeroIds.Length == 0
            ? new Dictionary<string, int>()
            : await dbContext.Viajes.AsNoTracking()
                .Where(viaje => viaje.Estado == EstadosViaje.Finalizado
                    && pasajeroIds.Contains(viaje.PasajeroId))
                .GroupBy(viaje => viaje.PasajeroId)
                .Select(grupo => new { UsuarioId = grupo.Key, Total = grupo.Count() })
                .ToDictionaryAsync(grupo => grupo.UsuarioId, grupo => grupo.Total, cancellationToken);

        var totalViajesConductor = conductorIds.Length == 0
            ? new Dictionary<string, int>()
            : await dbContext.Viajes.AsNoTracking()
                .Where(viaje => viaje.Estado == EstadosViaje.Finalizado
                    && viaje.ConductorId != null
                    && conductorIds.Contains(viaje.ConductorId))
                .GroupBy(viaje => viaje.ConductorId!)
                .Select(grupo => new { UsuarioId = grupo.Key, Total = grupo.Count() })
                .ToDictionaryAsync(grupo => grupo.UsuarioId, grupo => grupo.Total, cancellationToken);

        return viajes.Select(viaje => viaje with
        {
            PasajeroTotalViajes = totalViajesPasajero.GetValueOrDefault(viaje.PasajeroId),
            ConductorTotalViajes = viaje.ConductorId is null
                ? null
                : totalViajesConductor.GetValueOrDefault(viaje.ConductorId)
        }).ToArray();
    }

    private static ViajeResponse Mapear(Viaje viaje) =>
        new(viaje.Id, viaje.PasajeroId, viaje.ConductorId,
            viaje.OrigenLat, viaje.OrigenLng, viaje.DestinoLat, viaje.DestinoLng,
            viaje.Estado, viaje.Precio, viaje.ComisionPlataforma, viaje.MetodoPago, viaje.FechaCreacion,
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
            viaje.ComentarioCalificacion,
            MapearParadas(viaje.Paradas),
            viaje.Pasajero.PromedioCalificacion,
            0,
            viaje.Conductor?.PromedioCalificacion,
            viaje.Conductor is null ? null : 0);

    private static ParadaResponse[] MapearParadas(IEnumerable<ParadaViaje> paradas) =>
        paradas.OrderBy(parada => parada.Orden)
            .Select(parada => new ParadaResponse(parada.Orden, parada.Latitud, parada.Longitud))
            .ToArray();

    private static decimal CalcularComision(decimal precio) =>
        Math.Clamp(decimal.Round(precio * 0.15m, 2, MidpointRounding.AwayFromZero), 800m, 3000m);

    private static decimal GananciaNeta(decimal precio, decimal comision, string metodoPago) =>
        metodoPago == MetodosPago.Efectivo ? precio : precio - comision;

    private static decimal CalcularTarifa(SolicitarViajeRequest request)
    {
        const double earthRadiusKm = 6371;
        var waypoints = new List<(double Latitude, double Longitude)>
        {
            (request.OrigenLat, request.OrigenLng)
        };
        waypoints.AddRange((request.Paradas ?? [])
            .Select(parada => (parada.Latitud, parada.Longitud)));
        waypoints.Add((request.DestinoLat, request.DestinoLng));

        var distanceKm = 0d;
        for (var index = 1; index < waypoints.Count; index++)
        {
            var origin = waypoints[index - 1];
            var destination = waypoints[index];
            var latitude1 = DegreesToRadians(origin.Latitude);
            var latitude2 = DegreesToRadians(destination.Latitude);
            var deltaLatitude = DegreesToRadians(destination.Latitude - origin.Latitude);
            var deltaLongitude = DegreesToRadians(destination.Longitude - origin.Longitude);
            var haversine = Math.Pow(Math.Sin(deltaLatitude / 2), 2)
                + Math.Cos(latitude1) * Math.Cos(latitude2)
                * Math.Pow(Math.Sin(deltaLongitude / 2), 2);
            distanceKm += 2 * earthRadiusKm * Math.Asin(Math.Sqrt(haversine));
        }

        distanceKm *= 1.3;
        var estimate = 5000m + (decimal)distanceKm * 1800m;
        var distanceFare = decimal.Ceiling(estimate / 500m) * 500m;
        return distanceFare + (request.Paradas?.Count ?? 0) * 2_000m;
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180d;
}
