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

/// <summary>Correo al que se solicita enviar un código para restablecer la contraseña.</summary>
public sealed record SolicitarCodigoRestablecimientoRequest
{
    [Required, EmailAddress, MaxLength(256)]
    public required string Email { get; init; }
}

/// <summary>Correo, código temporal y nueva contraseña para restablecer el acceso.</summary>
public sealed record RestablecerContrasenaRequest
{
    [Required, EmailAddress, MaxLength(256)]
    public required string Email { get; init; }

    [Required, RegularExpression(@"^\d{6}$")]
    public required string Codigo { get; init; }

    [Required, MinLength(10), MaxLength(128)]
    public required string PasswordNueva { get; init; }
}

/// <summary>Mensaje de resultado de una operación de restablecimiento de contraseña.</summary>
public sealed record RestablecimientoContrasenaResponse(string Mensaje);

/// <summary>Credenciales de acceso, rol y datos de perfil del usuario autenticado.</summary>
public sealed record AuthResponse(string Token, string UsuarioId, string Email, string Rol, string Telefono, string Nombre);

/// <summary>Datos de perfil y calificación del usuario autenticado.</summary>
public sealed record PerfilUsuarioResponse(
    string Nombre,
    string Telefono,
    double PromedioCalificacion,
    int TotalCalificaciones,
    string? DireccionCasa,
    double? LatCasa,
    double? LngCasa,
    string? DireccionTrabajo,
    double? LatTrabajo,
    double? LngTrabajo,
    string EstadoVerificacion,
    string? MotivoRechazo,
    bool TieneLicencia,
    bool TieneSoat,
    bool TieneTarjetaPropiedad,
    DateTime? FechaVencimientoDocumentos);

/// <summary>Datos que se pueden actualizar en el perfil del usuario autenticado.</summary>
public sealed record ActualizarPerfilRequest
{
    [Required, StringLength(100, MinimumLength = 1)]
    public required string Nombre { get; init; }

    [Required, Phone, StringLength(32, MinimumLength = 1)]
    public required string Telefono { get; init; }

    [MaxLength(128)]
    public string? PasswordActual { get; init; }

    [MaxLength(128)]
    public string? PasswordNueva { get; init; }
}

/// <summary>Direcciones y coordenadas de los lugares favoritos del usuario autenticado.</summary>
public sealed record ActualizarLugaresFavoritosRequest
{
    [StringLength(300)]
    public string? DireccionCasa { get; init; }

    [Range(-90, 90)]
    public double? LatCasa { get; init; }

    [Range(-180, 180)]
    public double? LngCasa { get; init; }

    [StringLength(300)]
    public string? DireccionTrabajo { get; init; }

    [Range(-90, 90)]
    public double? LatTrabajo { get; init; }

    [Range(-180, 180)]
    public double? LngTrabajo { get; init; }
}

/// <summary>Ganancias netas acumuladas por el conductor en viajes finalizados.</summary>
public sealed record GananciasResponse(decimal GananciasAcumuladas);

public sealed record EstadisticasFinancierasConductorResponse(
    decimal TotalRecaudado,
    decimal GananciaNetaHoy,
    decimal SaldoPendiente);

/// <summary>Desglose financiero de un viaje finalizado para el historial del conductor.</summary>
public sealed record HistorialViajeConductorResponse(
    Guid ViajeId,
    DateTimeOffset Fecha,
    decimal MontoTotal,
    decimal Comision,
    decimal GananciaNeta);

/// <summary>Datos de un viaje finalizado incluidos en el historial del pasajero.</summary>
public sealed record HistorialViajePasajeroResponse(
    Guid ViajeId,
    DateTimeOffset Fecha,
    double OrigenLat,
    double OrigenLng,
    double DestinoLat,
    double DestinoLng,
    decimal MontoPagado,
    string? ConductorNombre);

/// <summary>Estadísticas acumuladas de viajes finalizados de un pasajero.</summary>
public sealed record EstadisticasPasajeroResponse(int TotalViajes, decimal TotalGastado);

/// <summary>Archivo y tipo de documento de identidad que carga un conductor.</summary>
public sealed record SubirDocumentoConductorRequest
{
    [Required]
    public required IFormFile Archivo { get; init; }

    [Required, RegularExpression("^(Licencia|SOAT|TarjetaPropiedad)$")]
    public required string TipoDocumento { get; init; }
}

/// <summary>Estado de verificación y documentos presentes del conductor autenticado.</summary>
public sealed record EstadoVerificacionConductorResponse(
    string EstadoVerificacion,
    string? MotivoRechazo,
    bool TieneLicencia,
    bool TieneSoat,
    bool TieneTarjetaPropiedad,
    DateTime? FechaVencimientoDocumentos);

/// <summary>Conductor con documentos pendientes de revisión administrativa.</summary>
public sealed record ConductorPendienteResponse(
    string Id,
    string Nombre,
    string Email,
    string Telefono,
    string UrlLicencia,
    string UrlSOAT,
    string UrlTarjetaPropiedad);

/// <summary>Decisión administrativa para aprobar o rechazar la verificación de un conductor.</summary>
public sealed record VerificarConductorRequest
{
    public required bool Aprobado { get; init; }

    public DateTime? FechaVencimientoDocumentos { get; init; }

    [StringLength(500)]
    public string? MotivoRechazo { get; init; }
}

public sealed record ConductorVencidoResponse(
    string Id,
    string Nombre,
    string Email,
    string Telefono,
    DateTime? FechaVencimientoDocumentos,
    string UrlLicencia,
    string UrlSOAT,
    string UrlTarjetaPropiedad);

/// <summary>Datos necesarios para validar un código promocional.</summary>
public sealed record ValidarPromocionRequest
{
    [Required, StringLength(32, MinimumLength = 3)]
    public required string Codigo { get; init; }
}

/// <summary>Porcentaje de descuento de un código promocional vigente.</summary>
public sealed record ValidarPromocionResponse(decimal PorcentajeDescuento);

/// <summary>Datos para crear un código promocional de administrador.</summary>
public sealed record CrearPromocionRequest
{
    [Required, StringLength(32, MinimumLength = 3), RegularExpression(@"^[A-Za-z0-9_-]+$")]
    public required string Codigo { get; init; }

    [Range(0.01, 100)]
    public required decimal PorcentajeDescuento { get; init; }

    public DateTimeOffset? FechaExpiracion { get; init; }
}

/// <summary>Datos de un código promocional.</summary>
public sealed record PromocionResponse(
    Guid Id,
    string Codigo,
    decimal PorcentajeDescuento,
    bool EstaActiva,
    DateTimeOffset? FechaExpiracion);

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

    [StringLength(32)]
    public string? CodigoPromo { get; init; }

    [Required, RegularExpression("^(Efectivo|Transferencia|Tarjeta)$")]
    public string MetodoPago { get; init; } = MetodosPago.Efectivo;

    [MaxLength(3)]
    public List<ParadaRequest>? Paradas { get; init; }
}

/// <summary>Coordenadas de una parada intermedia del viaje.</summary>
public sealed record ParadaRequest
{
    [Range(-90, 90)]
    public required double Latitud { get; init; }

    [Range(-180, 180)]
    public required double Longitud { get; init; }
}

/// <summary>Parada intermedia guardada en el orden de recorrido del viaje.</summary>
public sealed record ParadaResponse(int Orden, double Latitud, double Longitud);

/// <summary>Confirmación del viaje solicitado; el PIN solo se entrega al pasajero.</summary>
public sealed record SolicitudViajeResponse(
    Guid Id,
    string Estado,
    string Pin,
    decimal Precio,
    DateTimeOffset FechaCreacion,
    IReadOnlyList<ParadaResponse> Paradas);

/// <summary>Desglose del cobro al finalizar un viaje, pendiente de confirmar su recepción.</summary>
public sealed record FinalizacionViajeResponse(
    ViajeResponse Viaje,
    decimal MontoTotal,
    decimal Comision,
    decimal GananciaNeta);

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
    string MetodoPago,
    DateTimeOffset FechaCreacion,
    string? PasajeroNombre,
    string? Vehiculo,
    string? Placa,
    string? ConductorNombre,
    string? ConductorTelefono,
    int? Calificacion,
    string? ComentarioCalificacion,
    IReadOnlyList<ParadaResponse> Paradas,
    double PasajeroPromedioCalificacion,
    int PasajeroTotalViajes,
    double? ConductorPromedioCalificacion,
    int? ConductorTotalViajes);

/// <summary>Calificación de estrellas y comentario opcional de un viaje finalizado.</summary>
public sealed record CalificarViajeRequest
{
    [Range(1, 5)]
    public required int Estrellas { get; init; }

    [StringLength(1000)]
    public string? Comentario { get; init; }
}

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

/// <summary>Estadísticas administrativas de viajes, comisiones y disponibilidad.</summary>
public sealed record AdminEstadisticasResponse(
    long TotalViajes,
    decimal ComisionesTotales,
    decimal ComisionesRecibidas,
    decimal ComisionesPorCobrarEfectivo,
    long ViajesHoy,
    int ConductoresActivos,
    decimal RecaudadoHoy);

public sealed record ConductorConDeudaResponse(string Id, string Nombre, decimal SaldoPendiente);
