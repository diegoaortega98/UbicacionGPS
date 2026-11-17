using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public sealed class Promocion
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required, StringLength(32, MinimumLength = 3)]
    public string Codigo { get; set; } = string.Empty;

    [Range(typeof(decimal), "0.01", "100")]
    public decimal PorcentajeDescuento { get; set; }

    public bool EstaActiva { get; set; } = true;

    public DateTime? FechaExpiracion { get; set; }
}
