using GpsSystem.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GpsSystem.Api.Hubs;

[Authorize]
public sealed class LlamadaHub : ViajeHubBase
{
    public LlamadaHub(AppDbContext dbContext) : base(dbContext) { }

    public async Task UnirseLlamada(Guid viajeId)
    {
        await ValidarParticipanteAsync(viajeId);
        await Groups.AddToGroupAsync(Context.ConnectionId, GrupoParticipantes(viajeId));
    }

    public Task EnviarOferta(Guid viajeId, string sdp) =>
        ReenviarAsync(viajeId, "OfertaLlamada", sdp);

    public Task EnviarRespuesta(Guid viajeId, string sdp) =>
        ReenviarAsync(viajeId, "RespuestaLlamada", sdp);

    public Task EnviarCandidatoIce(Guid viajeId, string candidato) =>
        ReenviarAsync(viajeId, "CandidatoIce", candidato);

    public async Task RechazarLlamada(Guid viajeId)
    {
        await ValidarParticipanteAsync(viajeId);
        await Clients.GroupExcept(GrupoParticipantes(viajeId), Context.ConnectionId)
            .SendAsync("LlamadaRechazada", new { usuarioId = UsuarioId }, Context.ConnectionAborted);
    }

    private async Task ReenviarAsync(Guid viajeId, string evento, string valor)
    {
        if (string.IsNullOrWhiteSpace(valor) || valor.Length > 20_000)
        {
            throw new HubException("La señal WebRTC no es válida.");
        }

        await ValidarParticipanteAsync(viajeId);
        await Clients.GroupExcept(GrupoParticipantes(viajeId), Context.ConnectionId)
            .SendAsync(evento, new { usuarioId = UsuarioId, valor }, Context.ConnectionAborted);
    }
}
