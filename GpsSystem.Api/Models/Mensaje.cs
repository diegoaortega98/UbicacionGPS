using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public class Mensaje
{
    public long Id { get; set; }

    public Guid ViajeId { get; set; }

    [Required]
    public string RemitenteId { get; set; } = string.Empty;

    [Required]
    [MaxLength(2000)]
    public string Texto { get; set; } = string.Empty;

    public DateTimeOffset FechaHora { get; set; } = DateTimeOffset.UtcNow;

    public Viaje Viaje { get; set; } = null!;

    public Usuario Remitente { get; set; } = null!;
}
