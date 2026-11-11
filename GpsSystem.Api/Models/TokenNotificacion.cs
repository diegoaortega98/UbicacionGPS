using System.ComponentModel.DataAnnotations;

namespace GpsSystem.Api.Models;

public class TokenNotificacion
{
    public long Id { get; set; }

    [Required]
    public string UsuarioId { get; set; } = string.Empty;

    [Required]
    [MaxLength(1024)]
    public string Token { get; set; } = string.Empty;

    public DateTimeOffset ActualizadoEn { get; set; } = DateTimeOffset.UtcNow;

    public Usuario Usuario { get; set; } = null!;
}
