using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public class PerfilConductor
{
    [Key]
    public string UsuarioId { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string Vehiculo { get; set; } = string.Empty;

    [Required]
    [MaxLength(20)]
    public string Placa { get; set; } = string.Empty;

    public Usuario Usuario { get; set; } = null!;
}
