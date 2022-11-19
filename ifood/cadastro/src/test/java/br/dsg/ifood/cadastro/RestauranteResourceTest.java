package br.dsg.ifood.cadastro;

import static io.restassured.RestAssured.given;

import com.github.database.rider.cdi.api.DBRider;
import com.github.database.rider.core.api.configuration.DBUnit;
import com.github.database.rider.core.api.configuration.Orthography;
import com.github.database.rider.core.api.dataset.DataSet;

import org.approvaltests.JsonApprovals;
import org.junit.jupiter.api.Test;

import br.dsg.ifood.cadastro.pojo.Restaurante;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.Assert;

import javax.ws.rs.core.Response.Status;

@DBRider
@DBUnit(caseInsensitiveStrategy = Orthography.LOWERCASE)
@QuarkusTest
public class RestauranteResourceTest {

    @Test
    @DataSet("restaurante-cenario-1.yml")
    public void test_restaurantes_endpoint() {
        var string = given()
          .when().get("/restaurantes")
          .then()
             .statusCode(Status.CREATED.getStatusCode())
             .extract().asString();
        
        JsonApprovals.verifyJson(string);
        
    }
    
    @Test
    @DataSet("restaurante-cenario-1.yml")
    public void test_alterar_restaurantes_endpoint() {
    	
    	Restaurante dto = new Restaurante();
    	dto.id = 123L;
    	dto.nome = "novo nome";
    	
        given()
           .with().pathParam("idRestaurante", dto.id)
           .body(dto)
          .when().put("/restaurantes")
          .then()
             .statusCode(Status.NO_CONTENT.getStatusCode());
        
        Restaurante entidade = Restaurante.findById(dto.id);
        
        Assert.assertEquals(dto.nome, entidade.nome);
        
    }

}