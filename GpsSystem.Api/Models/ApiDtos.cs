using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

/// <summary>Datos para crear una cuenta de pasajero o conductor.</summary>
public sealed record RegistroRequest
{
    [Required, EmailAddress, MaxLength(256)]
    public required string Email { get; init; }

    [Required, MinLength(10), MaxLength(128)]
    public required string Password { get; init; }

    [Required, Phone, StringLength(32)]
    public required string Telefono { get; init; }

    [Required]
    public required string Rol { get; init; }

    [MaxLength(100)]
    public string? Vehiculo { get; init; }

    [MaxLength(20)]
    public string? Placa { get; init; }
}

/// <summary>Credenciales de inicio de sesión.</summary>
public sealed record LoginRequest
{
    [Required, EmailAddress]
    public required string Email { get; init; }

    [Required]
    public required string Password { get; init; }
}

/// <summary>Credenciales de acceso y rol del usuario autenticado.</summary>
public sealed record AuthResponse(string Token, string UsuarioId, string Email, string Rol);

/// <summary>Datos de origen y destino para solicitar un viaje.</summary>
public sealed record SolicitarViajeRequest
{
    [Required]
    [Range(-90, 90)]
    public required double OrigenLat { get; init; }

    [Required]
    [Range(-180, 180)]
    public required double OrigenLng { get; init; }

    [Required]
    [Range(-90, 90)]
    public required double DestinoLat { get; init; }

    [Required]
    [Range(-180, 180)]
    public required double DestinoLng { get; init; }
}

/// <summary>Confirmación del viaje solicitado; el PIN solo se entrega al pasajero.</summary>
public sealed record SolicitudViajeResponse(
    Guid Id,
    string Estado,
    string Pin,
    decimal Precio,
    DateTimeOffset FechaCreacion);

/// <summary>Resumen de un viaje sin información secreta de verificación.</summary>
public sealed record ViajeResponse(
    Guid Id,
    string PasajeroId,
    string? ConductorId,
    double OrigenLat,
    double OrigenLng,
    double DestinoLat,
    double DestinoLng,
    string Estado,
    decimal Precio,
    decimal ComisionPlataforma,
    DateTimeOffset FechaCreacion,
    string? Vehiculo,
    string? Placa);

/// <summary>PIN de cuatro dígitos entregado por el pasajero al conductor.</summary>
public sealed record IniciarViajeRequest
{
    [Required, RegularExpression(@"^\d{4}$")]
    public required string Pin { get; init; }
}

/// <summary>Mensaje persistido y compartido en el chat del viaje.</summary>
public sealed record MensajeResponse(long Id, Guid ViajeId, string RemitenteId, string Texto, DateTimeOffset FechaHora);

/// <summary>Contenido de un mensaje nuevo para el chat del viaje.</summary>
public sealed record EnviarMensajeRequest
{
    [Required, StringLength(2000, MinimumLength = 1)]
    public required string Texto { get; init; }
}

/// <summary>Señal WebRTC recibida de otro participante del viaje.</summary>
public sealed record SenalWebRtc(string Tipo, string Valor);

/// <summary>Token FCM web que se asocia a la cuenta autenticada.</summary>
public sealed record RegistrarTokenNotificacionRequest
{
    [Required, StringLength(1024, MinimumLength = 1)]
    public required string Token { get; init; }
}

/// <summary>Configuración pública de Firebase Messaging para el cliente web.</summary>
public sealed record FirebaseWebConfigResponse(
    string? ApiKey,
    string? AuthDomain,
    string? ProjectId,
    string? StorageBucket,
    string? MessagingSenderId,
    string? AppId,
    string? VapidKey);
