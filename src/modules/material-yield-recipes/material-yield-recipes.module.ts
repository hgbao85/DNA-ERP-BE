import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StockModule } from '../stock/stock.module';
import { MaterialYieldRecipeIssuesController } from './material-yield-recipe-issues.controller';
import { MaterialYieldRecipeIssuesService } from './material-yield-recipe-issues.service';
import { MaterialYieldRecipeProductionController } from './material-yield-recipe-production.controller';
import { MaterialYieldRecipeProductionService } from './material-yield-recipe-production.service';
import { MaterialYieldRecipesController } from './material-yield-recipes.controller';
import { MaterialYieldRecipesService } from './material-yield-recipes.service';

@Module({
  imports: [StockModule, NotificationsModule],
  controllers: [
    MaterialYieldRecipesController,
    MaterialYieldRecipeIssuesController,
    MaterialYieldRecipeProductionController,
  ],
  providers: [
    MaterialYieldRecipesService,
    MaterialYieldRecipeIssuesService,
    MaterialYieldRecipeProductionService,
  ],
  exports: [
    MaterialYieldRecipesService,
    MaterialYieldRecipeIssuesService,
    MaterialYieldRecipeProductionService,
  ],
})
export class MaterialYieldRecipesModule {}
