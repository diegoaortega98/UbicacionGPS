using Microsoft.AspNetCore.Identity;

namespace GpsSystem.Api.Models;

public class Usuario : IdentityUser
{
    public string Nombre { get; set; } = string.Empty;

    public string? ResetCode { get; set; }

    public DateTime? ResetCodeExpiration { get; set; }

    public string Rol { get; set; } = RolesUsuario.Pasajero;

    public string Telefono { get; set; } = string.Empty;

    public double PromedioCalificacion { get; set; } = 5.0;

    public int TotalCalificaciones { get; set; }

    public decimal SaldoPendiente { get; set; } = 0m;

    public string? DireccionCasa { get; set; }

    public double? LatCasa { get; set; }

    public double? LngCasa { get; set; }

    public string? DireccionTrabajo { get; set; }

    public double? LatTrabajo { get; set; }

    public double? LngTrabajo { get; set; }

    public string? UrlLicencia { get; set; }

    public string? UrlSOAT { get; set; }

    public string? UrlTarjetaPropiedad { get; set; }

    public DateTime? FechaVencimientoDocumentos { get; set; }

    public EstadoVerificacionConductor EstadoVerificacion { get; set; } =
        EstadoVerificacionConductor.Pendiente;

    public string? MotivoRechazo { get; set; }

    public PerfilConductor? PerfilConductor { get; set; }
}

public static class RolesUsuario
{
    public const string Admin = "Admin";
    public const string Pasajero = "Pasajero";
    public const string Conductor = "Conductor";
}

public enum EstadoVerificacionConductor
{
    Pendiente,
    Aprobado,
    Rechazado,
    Vencido
}
