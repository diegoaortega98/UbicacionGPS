using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public class CrearUbicacionRequest
{
    [Required]
    [StringLength(100, MinimumLength = 1)]
    public string DispositivoId { get; set; } = string.Empty;

    [Range(-90, 90)]
    public double Latitud { get; set; }

    [Range(-180, 180)]
    public double Longitud { get; set; }

    [Range(0, double.MaxValue)]
    public double Velocidad { get; set; }

    public DateTime? FechaHora { get; set; }
}
