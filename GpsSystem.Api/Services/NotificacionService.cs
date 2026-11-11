using FirebaseAdmin.Messaging;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Services;

public sealed class NotificacionService(
    AppDbContext dbContext,
    FirebaseMessagingProvider firebase,
    ILogger<NotificacionService> logger)
{
    public async Task RegistrarTokenAsync(string usuarioId, string token, CancellationToken cancellationToken)
    {
        var registro = await dbContext.TokensNotificacion
            .SingleOrDefaultAsync(item => item.Token == token, cancellationToken);

        if (registro is null)
        {
            dbContext.TokensNotificacion.Add(new TokenNotificacion
            {
                UsuarioId = usuarioId,
                Token = token,
                ActualizadoEn = DateTimeOffset.UtcNow
            });
        }
        else
        {
            registro.UsuarioId = usuarioId;
            registro.ActualizadoEn = DateTimeOffset.UtcNow;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task QuitarTokenAsync(string usuarioId, string token, CancellationToken cancellationToken)
    {
        await dbContext.TokensNotificacion
            .Where(item => item.UsuarioId == usuarioId && item.Token == token)
            .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task NotificarConductoresNuevaSolicitudAsync(
        Guid viajeId,
        decimal precio,
        CancellationToken cancellationToken)
    {
        var tokens = await dbContext.TokensNotificacion.AsNoTracking()
            .Where(item => item.Usuario.Rol == RolesUsuario.Conductor)
            .Select(item => item.Token)
            .ToListAsync(cancellationToken);

        await EnviarAsync(tokens, "Nuevo viaje disponible", $"Solicitud de viaje · ${precio:N0}", new Dictionary<string, string>
        {
            ["tipo"] = "NuevaSolicitud",
            ["viajeId"] = viajeId.ToString()
        }, cancellationToken);
    }

    public async Task NotificarParticipantesAsync(ViajeResponse viaje, CancellationToken cancellationToken)
    {
        if (viaje.Estado is not (EstadosViaje.Aceptado or EstadosViaje.Finalizado))
        {
            return;
        }

        var participantes = new[] { viaje.PasajeroId, viaje.ConductorId }
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct()
            .ToArray();
        var tokens = await dbContext.TokensNotificacion.AsNoTracking()
            .Where(item => participantes.Contains(item.UsuarioId))
            .Select(item => item.Token)
            .ToListAsync(cancellationToken);

        var (title, body) = viaje.Estado switch
        {
            EstadosViaje.Aceptado => ("Conductor asignado", "Tu viaje fue aceptado por un conductor."),
            EstadosViaje.Finalizado => ("Viaje finalizado", "Tu viaje ha llegado a su destino."),
            _ => throw new InvalidOperationException($"No se admite enviar FCM para el estado {viaje.Estado}.")
        };

        await EnviarAsync(tokens, title, body,
            new Dictionary<string, string>
            {
                ["tipo"] = "EstadoViaje",
                ["viajeId"] = viaje.Id.ToString(),
                ["estado"] = viaje.Estado
            }, cancellationToken);
    }

    private async Task EnviarAsync(
        IReadOnlyCollection<string> tokens,
        string title,
        string body,
        Dictionary<string, string> data,
        CancellationToken cancellationToken)
    {
        if (tokens.Count == 0)
        {
            return;
        }

        if (firebase.Messaging is null)
        {
            logger.LogWarning("Se omitieron {Count} notificaciones porque Firebase no está configurado.", tokens.Count);
            return;
        }

        foreach (var token in tokens)
        {
            try
            {
                await firebase.Messaging.SendAsync(new Message
                {
                    // getToken() en Firebase Messaging devuelve el registration token, no el FID.
#pragma warning disable CS0618
                    Token = token,
#pragma warning restore CS0618
                    Notification = new Notification { Title = title, Body = body },
                    Data = data
                }, cancellationToken);
            }
            catch (FirebaseMessagingException exception)
            {
                logger.LogWarning(exception, "Firebase rechazó una notificación para un token registrado.");
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "No se pudo enviar una notificación Firebase.");
            }
        }
    }
}
