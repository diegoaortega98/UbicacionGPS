using System.Security.Claims;
using GpsSystem.Api.Data;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Hubs;

public abstract class ViajeHubBase(AppDbContext dbContext) : Hub
{
    protected string UsuarioId =>
        Context.User?.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? throw new HubException("No se pudo identificar al usuario.");

    protected async Task ValidarParticipanteAsync(Guid viajeId)
    {
        var esParticipante = await dbContext.Viajes.AsNoTracking().AnyAsync(
            viaje => viaje.Id == viajeId
                && (viaje.PasajeroId == UsuarioId || viaje.ConductorId == UsuarioId),
            Context.ConnectionAborted);

        if (!esParticipante)
        {
            throw new HubException("No tienes acceso a este viaje.");
        }
    }

    protected static string GrupoParticipantes(Guid viajeId) => $"viaje_{viajeId:N}";
}
