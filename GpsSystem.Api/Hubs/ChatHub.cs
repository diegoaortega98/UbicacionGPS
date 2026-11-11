using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GpsSystem.Api.Hubs;

[Authorize]
public sealed class ChatHub : ViajeHubBase
{
    private readonly AppDbContext _dbContext;

    public ChatHub(AppDbContext dbContext) : base(dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task UnirseChat(Guid viajeId)
    {
        await ValidarParticipanteAsync(viajeId);
        await Groups.AddToGroupAsync(Context.ConnectionId, GrupoParticipantes(viajeId));
    }

    public async Task EnviarMensaje(Guid viajeId, string texto)
    {
        if (string.IsNullOrWhiteSpace(texto) || texto.Length > 2000)
        {
            throw new HubException("El mensaje debe tener entre 1 y 2000 caracteres.");
        }

        await ValidarParticipanteAsync(viajeId);
        var mensaje = new Mensaje
        {
            ViajeId = viajeId,
            RemitenteId = UsuarioId,
            Texto = texto.Trim(),
            FechaHora = DateTimeOffset.UtcNow
        };
        _dbContext.Mensajes.Add(mensaje);
        await _dbContext.SaveChangesAsync(Context.ConnectionAborted);

        await Clients.Group(GrupoParticipantes(viajeId)).SendAsync("RecibirMensaje", new MensajeResponse(
            mensaje.Id, mensaje.ViajeId, mensaje.RemitenteId, mensaje.Texto, mensaje.FechaHora),
            Context.ConnectionAborted);
    }
}
