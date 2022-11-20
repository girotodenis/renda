package br.dsg.ifood.cadastro;

import static io.restassured.RestAssured.given;

import javax.ws.rs.core.Response.Status;

import com.github.database.rider.cdi.api.DBRider;
import com.github.database.rider.core.api.configuration.DBUnit;
import com.github.database.rider.core.api.configuration.Orthography;
import com.github.database.rider.core.api.dataset.DataSet;

import org.approvaltests.JsonApprovals;
import org.junit.Assert;
import org.junit.jupiter.api.Test;

import br.dsg.ifood.cadastro.dto.AlterarRestauranteDTO;
import br.dsg.ifood.cadastro.pojo.Restaurante;
import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;

@DBRider
@DBUnit(caseInsensitiveStrategy = Orthography.LOWERCASE)
@QuarkusTestResource(CadastroTestResourceLifecycleManager.class)
@QuarkusTest
public class RestauranteResourceTest {

    @Test
    @DataSet("restaurante-cenario-1.yml")
    public void test_restaurantes_endpoint() {
        var string = given()
          .when().get("/restaurantes")
          .then()
             .statusCode(Status.OK.getStatusCode())
             .extract().asString();
        
        JsonApprovals.verifyJson(string);
        
    }
    
    @Test
    @DataSet("restaurante-cenario-1.yml")
    public void test_alterar_restaurantes_endpoint() {
    	
    	AlterarRestauranteDTO dto = new AlterarRestauranteDTO();
    	var id = 123L;
    	dto.nome = "novo nome";
    	
        given().contentType(ContentType.JSON)
           .with().pathParam("idRestaurante", id)
           .body(dto)
           .when().put("/restaurantes/{idRestaurante}")
          .then().statusCode(Status.NO_CONTENT.getStatusCode());
        
        Restaurante entidade = Restaurante.findById(id);
        
        Assert.assertEquals(dto.nome, entidade.nome);
        
    }

}