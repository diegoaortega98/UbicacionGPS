using System.Security.Claims;
using System.Globalization;
using System.Security.Cryptography;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    UserManager<Usuario> userManager,
    ITokenService tokenService,
    AppDbContext dbContext,
    IEmailService emailService) : ControllerBase
{
    [HttpPost("register")]
    [ProducesResponseType<AuthResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Registrar([FromBody] RegistroRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Telefono))
        {
            return BadRequest(new ProblemDetails { Status = 400, Title = "El teléfono es obligatorio." });
        }

        if (request.Rol is not (RolesUsuario.Pasajero or RolesUsuario.Conductor))
        {
            return BadRequest(new ProblemDetails { Status = 400, Title = "El rol debe ser Pasajero o Conductor." });
        }

        if (request.Rol == RolesUsuario.Conductor
            && (string.IsNullOrWhiteSpace(request.Vehiculo) || string.IsNullOrWhiteSpace(request.Placa)))
        {
            return BadRequest(new ProblemDetails { Status = 400, Title = "El conductor debe indicar vehículo y placa." });
        }

        if (await userManager.FindByEmailAsync(request.Email) is not null)
        {
            return Conflict(new ProblemDetails { Status = 409, Title = "Ya existe una cuenta con ese correo." });
        }

        if (request.Rol == RolesUsuario.Conductor
            && await dbContext.PerfilesConductores.AnyAsync(
                perfil => perfil.Placa.ToUpper() == request.Placa!.Trim().ToUpper(), cancellationToken))
        {
            return Conflict(new ProblemDetails { Status = 409, Title = "La placa ya está registrada." });
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var usuario = new Usuario
        {
            UserName = request.Email,
            Email = request.Email,
            Nombre = string.Empty,
            Telefono = request.Telefono.Trim(),
            PhoneNumber = request.Telefono.Trim(),
            Rol = request.Rol
        };
        var resultado = await userManager.CreateAsync(usuario, request.Password);
        if (!resultado.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            return BadRequest(new ProblemDetails
            {
                Status = 400,
                Title = "No se pudo crear la cuenta.",
                Detail = string.Join("; ", resultado.Errors.Select(error => error.Description))
            });
        }

        resultado = await userManager.AddToRoleAsync(usuario, request.Rol);
        if (!resultado.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Problem(statusCode: StatusCodes.Status500InternalServerError, title: "No se pudo asignar el rol.");
        }

        if (request.Rol == RolesUsuario.Conductor)
        {
            dbContext.PerfilesConductores.Add(new PerfilConductor
            {
                UsuarioId = usuario.Id,
                Vehiculo = request.Vehiculo!.Trim(),
                Placa = request.Placa!.Trim().ToUpperInvariant()
            });
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        var token = tokenService.CrearToken(usuario);
        return Ok(new AuthResponse(token, usuario.Id, usuario.Email!, usuario.Rol, usuario.Telefono, usuario.Nombre));
    }

    [HttpPost("login")]
    [ProducesResponseType<AuthResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> IniciarSesion(
        [FromBody] LoginRequest request,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var usuario = await userManager.FindByEmailAsync(request.Email);
        if (usuario is null || !await userManager.CheckPasswordAsync(usuario, request.Password))
        {
            return Unauthorized(new ProblemDetails { Status = 401, Title = "Correo o contraseña incorrectos." });
        }

        var roles = await userManager.GetRolesAsync(usuario);
        var rol = roles.FirstOrDefault() ?? usuario.Rol;
        if (usuario.Rol != rol)
        {
            usuario.Rol = rol;
        }

        var token = tokenService.CrearToken(usuario);
        return Ok(new AuthResponse(token, usuario.Id, usuario.Email!, usuario.Rol, usuario.Telefono, usuario.Nombre));
    }

    [HttpPost("forgot-password")]
    [ProducesResponseType<RestablecimientoContrasenaResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError)]
    public async Task<ActionResult<RestablecimientoContrasenaResponse>> SolicitarRestablecimiento(
        [FromBody] SolicitarCodigoRestablecimientoRequest request,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var usuario = await userManager.FindByEmailAsync(request.Email.Trim());
        if (usuario is not null)
        {
            var codigo = RandomNumberGenerator.GetInt32(0, 1_000_000)
                .ToString("D6", CultureInfo.InvariantCulture);
            usuario.ResetCode = codigo;
            usuario.ResetCodeExpiration = DateTime.UtcNow.AddMinutes(15);

            var resultado = await userManager.UpdateAsync(usuario);
            if (!resultado.Succeeded)
            {
                return Problem(
                    statusCode: StatusCodes.Status500InternalServerError,
                    title: "No se pudo guardar el código de restablecimiento.",
                    detail: string.Join("; ", resultado.Errors.Select(error => error.Description)));
            }

            await emailService.EnviarCodigoRecuperacionAsync(
                usuario.Email!,
                codigo,
                cancellationToken);
        }

        return Ok(new RestablecimientoContrasenaResponse(
            "Si el correo está registrado, se generó un código de restablecimiento."));
    }

    [HttpPost("reset-password")]
    [ProducesResponseType<RestablecimientoContrasenaResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<RestablecimientoContrasenaResponse>> RestablecerContrasena(
        [FromBody] RestablecerContrasenaRequest request,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var usuario = await userManager.FindByEmailAsync(request.Email.Trim());
        if (usuario is null
            || !string.Equals(usuario.ResetCode, request.Codigo, StringComparison.Ordinal)
            || usuario.ResetCodeExpiration is not DateTime expiration
            || expiration <= DateTime.UtcNow)
        {
            return BadRequest(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "El código no es válido o ha expirado."
            });
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var resetToken = await userManager.GeneratePasswordResetTokenAsync(usuario);
        var resetResult = await userManager.ResetPasswordAsync(usuario, resetToken, request.PasswordNueva);
        if (!resetResult.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            return BadRequest(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "No se pudo restablecer la contraseña.",
                Detail = string.Join("; ", resetResult.Errors.Select(error => error.Description))
            });
        }

        usuario.ResetCode = null;
        usuario.ResetCodeExpiration = null;
        var updateResult = await userManager.UpdateAsync(usuario);
        if (!updateResult.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "No se pudo invalidar el código de restablecimiento.",
                detail: string.Join("; ", updateResult.Errors.Select(error => error.Description)));
        }

        await transaction.CommitAsync(cancellationToken);
        return Ok(new RestablecimientoContrasenaResponse("La contraseña se restableció correctamente."));
    }

    [HttpGet("perfil")]
    [Authorize]
    public async Task<ActionResult<PerfilUsuarioResponse>> Perfil(CancellationToken cancellationToken)
    {
        var usuarioId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(usuarioId))
        {
            return Unauthorized();
        }

        var perfil = await dbContext.Users.AsNoTracking()
            .Where(usuario => usuario.Id == usuarioId)
            .Select(usuario => new PerfilUsuarioResponse(
                usuario.Nombre,
                usuario.Telefono,
                usuario.PromedioCalificacion,
                usuario.TotalCalificaciones,
                usuario.DireccionCasa,
                usuario.LatCasa,
                usuario.LngCasa,
                usuario.DireccionTrabajo,
                usuario.LatTrabajo,
                usuario.LngTrabajo,
                usuario.EstadoVerificacion == EstadoVerificacionConductor.Aprobado
                    ? "Aprobado"
                    : usuario.EstadoVerificacion == EstadoVerificacionConductor.Rechazado
                        ? "Rechazado"
                        : "Pendiente",
                usuario.MotivoRechazo,
                usuario.UrlLicencia != null,
                usuario.UrlSOAT != null,
                usuario.UrlTarjetaPropiedad != null))
            .SingleOrDefaultAsync(cancellationToken);
        return perfil is null ? NotFound() : Ok(perfil);
    }

    [HttpPut("perfil")]
    [Authorize]
    [ProducesResponseType<PerfilUsuarioResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<PerfilUsuarioResponse>> ActualizarPerfil(
        [FromBody] ActualizarPerfilRequest request,
        CancellationToken cancellationToken)
    {
        var usuarioId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(usuarioId))
        {
            return Unauthorized();
        }

        if (!string.IsNullOrEmpty(request.PasswordNueva) && request.PasswordNueva.Length < 10)
        {
            return BadRequest(new ProblemDetails
            {
                Status = 400,
                Title = "La nueva contraseña debe contener al menos 10 caracteres."
            });
        }

        var nombre = request.Nombre.Trim();
        var telefono = request.Telefono.Trim();
        if (nombre.Length == 0 || telefono.Length == 0)
        {
            return BadRequest(new ProblemDetails { Status = 400, Title = "El nombre y el teléfono son obligatorios." });
        }

        var usuario = await userManager.FindByIdAsync(usuarioId);
        if (usuario is null)
        {
            return NotFound();
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        if (!string.IsNullOrEmpty(request.PasswordNueva))
        {
            if (string.IsNullOrEmpty(request.PasswordActual))
            {
                await transaction.RollbackAsync(cancellationToken);
                return BadRequest(new ProblemDetails
                {
                    Status = 400,
                    Title = "Debes ingresar tu contraseña actual para cambiarla."
                });
            }

            var passwordResult = await userManager.ChangePasswordAsync(
                usuario, request.PasswordActual, request.PasswordNueva);
            if (!passwordResult.Succeeded)
            {
                await transaction.RollbackAsync(cancellationToken);
                return BadRequest(new ProblemDetails
                {
                    Status = 400,
                    Title = "No se pudo cambiar la contraseña.",
                    Detail = string.Join("; ", passwordResult.Errors.Select(error => error.Description))
                });
            }
        }

        usuario.Nombre = nombre;
        usuario.Telefono = telefono;
        usuario.PhoneNumber = telefono;
        var updateResult = await userManager.UpdateAsync(usuario);
        if (!updateResult.Succeeded)
        {
            await transaction.RollbackAsync(cancellationToken);
            return BadRequest(new ProblemDetails
            {
                Status = 400,
                Title = "No se pudo actualizar el perfil.",
                Detail = string.Join("; ", updateResult.Errors.Select(error => error.Description))
            });
        }

        await transaction.CommitAsync(cancellationToken);
        return Ok(CrearPerfilResponse(usuario));
    }

    [HttpPut("lugares-favoritos")]
    [Authorize]
    [ProducesResponseType<PerfilUsuarioResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<PerfilUsuarioResponse>> ActualizarLugaresFavoritos(
        [FromBody] ActualizarLugaresFavoritosRequest request,
        CancellationToken cancellationToken)
    {
        var usuarioId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(usuarioId))
        {
            return Unauthorized();
        }

        if (!LugarFavoritoEsValido(request.DireccionCasa, request.LatCasa, request.LngCasa)
            || !LugarFavoritoEsValido(request.DireccionTrabajo, request.LatTrabajo, request.LngTrabajo))
        {
            return BadRequest(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Cada lugar debe incluir dirección, latitud y longitud, o dejarse vacío."
            });
        }

        var usuario = await userManager.FindByIdAsync(usuarioId);
        if (usuario is null)
        {
            return NotFound();
        }

        usuario.DireccionCasa = NormalizarDireccion(request.DireccionCasa);
        usuario.LatCasa = usuario.DireccionCasa is null ? null : request.LatCasa;
        usuario.LngCasa = usuario.DireccionCasa is null ? null : request.LngCasa;
        usuario.DireccionTrabajo = NormalizarDireccion(request.DireccionTrabajo);
        usuario.LatTrabajo = usuario.DireccionTrabajo is null ? null : request.LatTrabajo;
        usuario.LngTrabajo = usuario.DireccionTrabajo is null ? null : request.LngTrabajo;

        var updateResult = await userManager.UpdateAsync(usuario);
        if (!updateResult.Succeeded)
        {
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "No se pudieron actualizar los lugares favoritos.",
                detail: string.Join("; ", updateResult.Errors.Select(error => error.Description)));
        }

        return Ok(CrearPerfilResponse(usuario));
    }

    private static bool LugarFavoritoEsValido(string? direccion, double? latitud, double? longitud)
    {
        var tieneDireccion = !string.IsNullOrWhiteSpace(direccion);
        return tieneDireccion == (latitud.HasValue && longitud.HasValue)
            && latitud.HasValue == longitud.HasValue;
    }

    private static string? NormalizarDireccion(string? direccion) =>
        string.IsNullOrWhiteSpace(direccion) ? null : direccion.Trim();

    private static PerfilUsuarioResponse CrearPerfilResponse(Usuario usuario) =>
        new(
            usuario.Nombre,
            usuario.Telefono,
            usuario.PromedioCalificacion,
            usuario.TotalCalificaciones,
            usuario.DireccionCasa,
            usuario.LatCasa,
            usuario.LngCasa,
            usuario.DireccionTrabajo,
            usuario.LatTrabajo,
            usuario.LngTrabajo,
            usuario.EstadoVerificacion.ToString(),
            usuario.MotivoRechazo,
            usuario.UrlLicencia is not null,
            usuario.UrlSOAT is not null,
            usuario.UrlTarjetaPropiedad is not null);
}
