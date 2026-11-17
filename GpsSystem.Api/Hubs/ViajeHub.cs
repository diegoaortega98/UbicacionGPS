using System.Security.Claims;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Hubs;

[Authorize]
public sealed class ViajeHub : ViajeHubBase
{
    private readonly AppDbContext _dbContext;
    private readonly IConductoresActivosTracker _conductoresActivos;

    public const string GrupoConductores = "conductores";

    public ViajeHub(AppDbContext dbContext, IConductoresActivosTracker conductoresActivos) : base(dbContext)
    {
        _dbContext = dbContext;
        _conductoresActivos = conductoresActivos;
    }

    public static string GrupoViaje(Guid viajeId) => $"viaje_{viajeId:N}";

    public async Task EstablecerDisponibilidad(bool disponible)
    {
        if (Context.User?.IsInRole(RolesUsuario.Conductor) != true)
        {
            throw new HubException("Solo los conductores pueden cambiar su disponibilidad.");
        }

        if (disponible)
        {
            var conductor = await _dbContext.Users.AsNoTracking().SingleOrDefaultAsync(
                usuario => usuario.Id == UsuarioId
                    && usuario.Rol == RolesUsuario.Conductor,
                Context.ConnectionAborted);
            if (conductor is null || conductor.EstadoVerificacion != EstadoVerificacionConductor.Aprobado)
            {
                throw new HubException("Debes tener tus documentos aprobados antes de conectarte.");
            }

            if (!conductor.FechaVencimientoDocumentos.HasValue
                || conductor.FechaVencimientoDocumentos.Value.Date < DateTime.UtcNow.Date)
            {
                await _dbContext.Users
                    .Where(usuario => usuario.Id == conductor.Id)
                    .ExecuteUpdateAsync(
                        setters => setters.SetProperty(
                            usuario => usuario.EstadoVerificacion,
                            EstadoVerificacionConductor.Vencido),
                        Context.ConnectionAborted);
                throw new HubException("Tus documentos están vencidos. Actualízalos antes de conectarte.");
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, GrupoConductores);
            _conductoresActivos.EstablecerDisponibilidad(Context.ConnectionId, UsuarioId, true);
        }
        else
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, GrupoConductores);
            _conductoresActivos.EstablecerDisponibilidad(Context.ConnectionId, UsuarioId, false);
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _conductoresActivos.Desconectar(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task UnirseViaje(Guid viajeId)
    {
        await ValidarParticipanteAsync(viajeId);
        await Groups.AddToGroupAsync(Context.ConnectionId, GrupoViaje(viajeId));
    }

    public async Task ActualizarUbicacion(Guid viajeId, double latitud, double longitud, double velocidad)
    {
        try
        {
            var esConductor = Context.User?.IsInRole(RolesUsuario.Conductor) == true;
            var esPasajero = Context.User?.IsInRole(RolesUsuario.Pasajero) == true;
            if ((!esConductor && !esPasajero)
                || !double.IsFinite(latitud)
                || !double.IsFinite(longitud)
                || !double.IsFinite(velocidad)
                || latitud is < -90 or > 90
                || longitud is < -180 or > 180
                || velocidad < 0)
            {
                throw new HubException("La ubicación del participante no es válida.");
            }

            var viajeAsignado = await _dbContext.Viajes.AsNoTracking().AnyAsync(
                viaje => viaje.Id == viajeId
                    && (esConductor
                        ? viaje.ConductorId == UsuarioId
                        : viaje.PasajeroId == UsuarioId)
                    && (viaje.Estado == EstadosViaje.Aceptado
                        || viaje.Estado == EstadosViaje.Llegando
                        || viaje.Estado == EstadosViaje.EnCurso),
                Context.ConnectionAborted);
            if (!viajeAsignado)
            {
                throw new HubException("No puedes compartir ubicación para este viaje.");
            }

            await Clients.Group(GrupoViaje(viajeId)).SendAsync("UbicacionParticipante", new
            {
                viajeId,
                usuarioId = UsuarioId,
                rol = esConductor ? RolesUsuario.Conductor : RolesUsuario.Pasajero,
                latitud,
                longitud,
                velocidad,
                fechaHora = DateTimeOffset.UtcNow
            }, Context.ConnectionAborted);
        }
        catch (HubException ex)
        {
            Console.WriteLine($"Error en Hub al actualizar ubicación: {ex.Message}");
            throw;
        }
    }
}
