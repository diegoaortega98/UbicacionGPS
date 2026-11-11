using System.Security.Claims;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GpsSystem.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    UserManager<Usuario> userManager,
    ITokenService tokenService,
    AppDbContext dbContext) : ControllerBase
{
    [HttpPost("register")]
    [ProducesResponseType<AuthResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Registrar([FromBody] RegistroRequest request, CancellationToken cancellationToken)
    {
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
        return Ok(new AuthResponse(token, usuario.Id, usuario.Email!, usuario.Rol));
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
        return Ok(new AuthResponse(token, usuario.Id, usuario.Email!, usuario.Rol));
    }
}
