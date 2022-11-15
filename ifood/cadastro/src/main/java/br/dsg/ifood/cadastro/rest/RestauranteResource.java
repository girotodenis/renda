package br.dsg.ifood.cadastro.rest;

import java.util.List;
import java.util.Optional;

import javax.transaction.Transactional;
import javax.ws.rs.Consumes;
import javax.ws.rs.DELETE;
import javax.ws.rs.GET;
import javax.ws.rs.NotFoundException;
import javax.ws.rs.POST;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.Response.Status;

import br.dsg.ifood.cadastro.pojo.Restaurante;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;

@Path("/restaurantes")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RestauranteResource {

	@GET
	public List<Restaurante> todos() {
		
		return Restaurante.listAll();
	}

	@POST
	@Transactional
	public void cadastrar(Restaurante dto) {
		
		dto.id = null;
		dto.persist();
	}
	
	@PUT
	@Path("{id}")
	@Transactional
	public Response alterar(@PathParam("id")Long id, Restaurante dto) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(id);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		restaurante.nome = dto.nome; 
		restaurante.persist();
		return Response.status(Status.CREATED).build();
	}
	
	@DELETE
	@Path("{id}")
	@Transactional
	public void deletar(@PathParam("id")Long id) {
		
		Optional<Restaurante> restauranteOP = Restaurante.findByIdOptional(id);
		Restaurante restaurante = restauranteOP.orElseThrow(NotFoundException::new);
		restaurante.delete();
	}

}