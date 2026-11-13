using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public static class EstadosViaje
{
    public const string Solicitado = "Solicitado";
    public const string Aceptado = "Aceptado";
    public const string Llegando = "Llegando";
    public const string EnCurso = "EnCurso";
    public const string PendientePago = "PendientePago";
    public const string Cancelado = "Cancelado";
    public const string Finalizado = "Finalizado";
}

public class Viaje
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public string PasajeroId { get; set; } = string.Empty;

    public string? ConductorId { get; set; }

    public double OrigenLat { get; set; }

    public double OrigenLng { get; set; }

    public double DestinoLat { get; set; }

    public double DestinoLng { get; set; }

    [MaxLength(20)]
    public string Estado { get; set; } = EstadosViaje.Solicitado;

    [Required]
    [MaxLength(64)]
    public string Pin { get; set; } = string.Empty;

    public decimal Precio { get; set; }

    public decimal ComisionPlataforma { get; set; }

    public DateTimeOffset FechaCreacion { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? FechaFinalizacion { get; set; }

    public Usuario Pasajero { get; set; } = null!;

    public Usuario? Conductor { get; set; }

    public ICollection<Mensaje> Mensajes { get; set; } = new List<Mensaje>();
}
