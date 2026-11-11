using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public class Transaccion
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ViajeId { get; set; }

    public decimal Monto { get; set; }

    public decimal Comision { get; set; }

    [Required]
    [MaxLength(30)]
    public string Estado { get; set; } = "Pendiente";

    public DateTimeOffset FechaCreacion { get; set; } = DateTimeOffset.UtcNow;

    public Viaje Viaje { get; set; } = null!;
}
