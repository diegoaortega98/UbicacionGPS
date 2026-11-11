using System.Security.Claims;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GpsSystem.Api.Hubs;

[Authorize]
public sealed class ViajeHub : ViajeHubBase
{
    public const string GrupoConductores = "conductores";

    public ViajeHub(AppDbContext dbContext) : base(dbContext) { }

    public static string GrupoViaje(Guid viajeId) => $"viaje_{viajeId:N}";

    public override async Task OnConnectedAsync()
    {
        if (Context.User?.IsInRole(RolesUsuario.Conductor) == true)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, GrupoConductores);
        }

        await base.OnConnectedAsync();
    }

    public async Task UnirseViaje(Guid viajeId)
    {
        await ValidarParticipanteAsync(viajeId);
        await Groups.AddToGroupAsync(Context.ConnectionId, GrupoViaje(viajeId));
    }
}
