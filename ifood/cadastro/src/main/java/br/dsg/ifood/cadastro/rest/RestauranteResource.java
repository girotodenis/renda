package br.dsg.ifood.cadastro.rest;

import java.util.List;
import java.util.stream.Collectors;

import javax.enterprise.context.RequestScoped;
import javax.inject.Inject;
import javax.validation.Valid;
import javax.ws.rs.Consumes;
import javax.ws.rs.DELETE;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.Response.Status;

import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;

import br.dsg.ifood.cadastro.dto.AdicionarRestauranteDTO;
import br.dsg.ifood.cadastro.dto.AlterarRestauranteDTO;
import br.dsg.ifood.cadastro.dto.RestauranteDTO;
import br.dsg.ifood.cadastro.dto.RestauranteMapper;
import br.dsg.ifood.cadastro.repository.RestauranteRepository;
import br.dsg.ifood.cadastro.rest.exception.ConstraintViolationImpl;
import br.dsg.ifood.cadastro.service.RestauranteService;

@RequestScoped
@Path("/restaurantes")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RestauranteResource {
	
	@Inject
	RestauranteMapper restauranteMapper;
	
	@Inject
	PratoSubResource pratoSubResource;
	
	@Inject
	RestauranteRepository restauranteRepository;
	
	@Inject
	RestauranteService restauranteService;
	
	@GET
	public List<RestauranteDTO> todos() {
		
		return restauranteRepository.findAll().list()
				.stream()
				.map(restauranteMapper::toRestauranteDTO)
				.collect(Collectors.toList());
	}

	@POST
	@APIResponse(responseCode = "201", description = "Caso restauranteseja cadastrado com sucesso")
	@APIResponse(responseCode = "400", content = @Content(schema = @Schema(allOf = ConstraintViolationImpl.class )))
	public Response cadastrar(@Valid AdicionarRestauranteDTO dto) {
		
		restauranteService.adicionar( dto );
		return Response.status(Status.CREATED).build();
	}
	
	@PUT
	@Path("{idRestaurante}")
	public Response alterar(@PathParam("idRestaurante")Long idRestaurante, AlterarRestauranteDTO dto) {
		
		restauranteService.alterar( idRestaurante, dto );
		return Response.status(Status.NO_CONTENT).build();
	}
	
	@DELETE
	@Path("{idRestaurante}")
	public Response deletar(@PathParam("idRestaurante")Long idRestaurante) {
		
		restauranteService.deletar( idRestaurante );
		return Response.status(Status.NO_CONTENT).build();
	}
	
	@Path("{idRestaurante}/pratos")
	public PratoSubResource acessarPratos() {
		return pratoSubResource;
	}
	
}