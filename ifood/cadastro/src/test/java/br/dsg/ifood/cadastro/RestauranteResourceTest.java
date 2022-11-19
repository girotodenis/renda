package br.dsg.ifood.cadastro;

import static io.restassured.RestAssured.given;

import com.github.database.rider.cdi.api.DBRider;
import com.github.database.rider.core.api.configuration.DBUnit;
import com.github.database.rider.core.api.configuration.Orthography;
import com.github.database.rider.core.api.dataset.DataSet;

import org.approvaltests.JsonApprovals;
import org.junit.jupiter.api.Test;

import io.quarkus.test.junit.QuarkusTest;

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
             .statusCode(200)
             .extract().asString();
        
        JsonApprovals.verifyJson(string);
        
    }

}